import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';

/**
 * Configuration options for SSE chat functionality
 */
interface SSEChatOptions {
  maxRetries?: number;    // Maximum retry attempts
  retryDelay?: number;    // Retry interval (milliseconds)
}

/**
 * Extract data portion from SSE format line
 * @param line One line of SSE
 * @returns Extracted data, or null
 */
const extractDataFromLine = (line: string): string | null => {
  if (line.startsWith('data: ')) {
    return line.slice(6).trim();
  }
  return null;
};

/**
 * Extract message content from parsed JSON
 * @param parsed Parsed JSON object
 * @returns Extracted text content, or null
 */
const extractMessageContent = (parsed: Record<string, unknown>): string | null => {
  // Error check
  if (parsed.error && typeof parsed.error === 'string') {
    throw new Error(parsed.error);
  }

  if (parsed.event && typeof parsed.event === 'object' && parsed.event !== null) {
    const event = parsed.event as { contentBlockDelta?: { delta?: { text?: string } } };
    if (event.contentBlockDelta?.delta?.text) {
      return event.contentBlockDelta.delta.text;
    }
  }

  return null;
};

/**
 * Process SSE response and update messages
 * @param response Fetch response
 * @param onMessageUpdate Callback for message updates
 * @param onComplete Callback for completion
 */
const processStreamingResponse = async (
  response: Response,
  onMessageUpdate: (message: string) => void,
  onComplete: (finalMessage: string) => void
): Promise<void> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let currentMessage = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Convert binary data to text
      buffer += decoder.decode(value, { stream: true });

      // Split by newlines and process each line
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        const dataToProcess = extractDataFromLine(line);
        if (!dataToProcess) continue;

        try {
          const parsed = JSON.parse(dataToProcess);
          const content = extractMessageContent(parsed);
          if (content) {
            currentMessage += content;
            onMessageUpdate(currentMessage);
          }
        } catch {
          // Ignore JSON parse errors and continue
        }
      }
    }

    onComplete(currentMessage);
  } finally {
    reader.releaseLock();
  }
};

/**
 * Custom hook for chat functionality using SSE (Server-Sent Events)
 * 
 * @param options Configuration options
 * @returns Chat functionality state and functions
 */
export function useSSEChat(options: SSEChatOptions = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  // State management
  const [messages, setMessages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authentication management
  const { getAuthTokens } = useAuth();

  /**
   * Send message and receive AI response
   * @param prompt User input prompt
   * @param retryCount Current retry count (internal use)
   */
  const sendMessage = useCallback(async (
    prompt: string,
    retryCount = 0
  ): Promise<void> => {
    if (!prompt?.trim()) return;

    setIsLoading(true);
    setError(null);

    // Get authentication tokens
    const { idToken, accessToken } = await getAuthTokens();
    if (!idToken || !accessToken) {
      setError('Unable to get authentication tokens');
      setIsLoading(false);
      return;
    }

    try {
      console.log('Sending message to API:', prompt);
      console.log('Using tokens:', { idToken: idToken ? 'present' : 'missing', accessToken: accessToken ? 'present' : 'missing' });
      
      // Send request to SSE API
      const response = await fetch('/api/agent-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${idToken}`,
          'X-Access-Token': accessToken,
        },
        body: JSON.stringify({ prompt }),
      });

      console.log('API Response status:', response.status);
      console.log('API Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Add new message slot
      setMessages(prev => [...prev, '']);

      // Process streaming response
      await processStreamingResponse(
        response,
        // On message update
        (currentMessage) => {
          setMessages(prev => [...prev.slice(0, -1), currentMessage]);
        },
        // On completion
        (finalMessage) => {
          if (finalMessage) {
            setMessages(prev => [...prev.slice(0, -1), finalMessage]);
          } else {
            setMessages(prev => prev.slice(0, -1));
          }
        }
      );

    } catch (fetchError) {
      // Automatic retry (exponential backoff)
      if (retryCount < maxRetries) {
        setTimeout(() => {
          sendMessage(prompt, retryCount + 1);
        }, retryDelay * Math.pow(2, retryCount));
      } else {
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        setError(`Communication error: ${errorMessage}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [getAuthTokens, maxRetries, retryDelay]);

  /**
   * Clear message history
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,      // Message history
    isLoading,     // Sending flag
    error,         // Error message
    sendMessage,   // Message sending function
    clearMessages, // History clear function
  };
}