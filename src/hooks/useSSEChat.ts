import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';

/**
 * SSEチャット機能のオプション設定
 */
interface SSEChatOptions {
  maxRetries?: number;    // 最大再試行回数
  retryDelay?: number;    // 再試行間隔（ミリ秒）
}

/**
 * SSE形式の行からデータ部分を抽出する
 * @param line SSEの1行
 * @returns 抽出されたデータ、または null
 */
const extractDataFromLine = (line: string): string | null => {
  if (line.startsWith('data: ')) {
    return line.slice(6).trim();
  }
  return null;
};

/**
 * パースされたJSONからメッセージ内容を抽出する
 * @param parsed パースされたJSONオブジェクト
 * @returns 抽出されたテキスト内容、または null
 */
const extractMessageContent = (parsed: Record<string, unknown>): string | null => {
  // エラーチェック
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
 * SSEレスポンスを処理してメッセージを更新する
 * @param response Fetchレスポンス
 * @param onMessageUpdate メッセージ更新時のコールバック
 * @param onComplete 完了時のコールバック
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

      // バイナリデータをテキストに変換
      buffer += decoder.decode(value, { stream: true });

      // 改行で分割して各行を処理
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
          // JSONパースエラーは無視して続行
        }
      }
    }

    onComplete(currentMessage);
  } finally {
    reader.releaseLock();
  }
};

/**
 * SSE（Server-Sent Events）を使用したチャット機能のカスタムフック
 * 
 * @param options 設定オプション
 * @returns チャット機能のstate と関数
 */
export function useSSEChat(options: SSEChatOptions = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;

  // State管理
  const [messages, setMessages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 認証管理
  const { getAuthTokens } = useAuth();

  /**
   * メッセージを送信してAIからの応答を受信する
   * @param prompt ユーザーからの入力プロンプト
   * @param retryCount 現在の再試行回数（内部使用）
   */
  const sendMessage = useCallback(async (
    prompt: string,
    retryCount = 0
  ): Promise<void> => {
    if (!prompt?.trim()) return;

    setIsLoading(true);
    setError(null);

    // 認証トークンを取得
    const { idToken, accessToken } = await getAuthTokens();
    if (!idToken || !accessToken) {
      setError('認証トークンが取得できません');
      setIsLoading(false);
      return;
    }

    try {
      // SSE APIにリクエストを送信
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

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('レスポンスボディがありません');
      }

      // 新しいメッセージスロットを追加
      setMessages(prev => [...prev, '']);

      // ストリーミングレスポンスを処理
      await processStreamingResponse(
        response,
        // メッセージ更新時
        (currentMessage) => {
          setMessages(prev => [...prev.slice(0, -1), currentMessage]);
        },
        // 完了時
        (finalMessage) => {
          if (finalMessage) {
            setMessages(prev => [...prev.slice(0, -1), finalMessage]);
          } else {
            setMessages(prev => prev.slice(0, -1));
          }
        }
      );

    } catch (fetchError) {
      // 自動再試行（指数バックオフ）
      if (retryCount < maxRetries) {
        setTimeout(() => {
          sendMessage(prompt, retryCount + 1);
        }, retryDelay * Math.pow(2, retryCount));
      } else {
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        setError(`通信エラー: ${errorMessage}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [getAuthTokens, maxRetries, retryDelay]);

  /**
   * メッセージ履歴をクリアする
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,      // メッセージ履歴
    isLoading,     // 送信中フラグ
    error,         // エラーメッセージ
    sendMessage,   // メッセージ送信関数
    clearMessages, // 履歴クリア関数
  };
}