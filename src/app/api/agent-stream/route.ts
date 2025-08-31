import { NextRequest } from 'next/server';
import { verifyJWT } from '@/lib/auth-utils';
import { getErrorMessage, logError } from '@/lib/error-utils';

/**
 * Decode JWT token without verification (for debugging)
 */
function decodeJWT(token: string) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const payload = JSON.parse(atob(parts[1]));
        return payload;
    } catch (error) {
        console.error('Failed to decode JWT:', error);
        return null;
    }
}

const BEDROCK_AGENT_CORE_ENDPOINT_URL = "https://bedrock-agentcore.us-west-2.amazonaws.com"

/**
 * Extract and validate ID token from request
 */
async function validateIdToken(request: NextRequest): Promise<string> {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Missing ID token');
    }

    const idToken = authHeader.substring(7);
    const isValid = await verifyJWT(idToken);
    if (!isValid) {
        throw new Error('Invalid ID token');
    }

    return idToken;
}

/**
 * Extract access token from request
 */
function extractAccessToken(request: NextRequest): string {
    const accessToken = request.headers.get('x-access-token');
    if (!accessToken) {
        throw new Error('Missing access token');
    }
    return accessToken;
}

/**
 * Handle communication with AgentCore Runtime
 */
async function streamFromAgentCore(
    accessToken: string,
    prompt: string,
    _sessionId: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
    agentCoreEndpoint: string
): Promise<void> {
    const encoder = new TextEncoder();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'text/event-stream',
    };

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let isClosed = false;

    const safeClose = () => {
        if (!isClosed) {
            isClosed = true;
            try {
                controller.close();
            } catch (error) {
                console.warn('Controller already closed:', error);
            }
        }
    };

    const safeEnqueue = (data: Uint8Array) => {
        if (!isClosed) {
            try {
                controller.enqueue(data);
            } catch (error) {
                console.warn('Failed to enqueue data:', error);
                isClosed = true;
            }
        }
    };

    try {
        const encodedEndpoint = encodeURIComponent(agentCoreEndpoint);
        const fullUrl = `${BEDROCK_AGENT_CORE_ENDPOINT_URL}/runtimes/${encodedEndpoint}/invocations`;
        console.log("fullUrl:", fullUrl)
        console.log("agentCoreEndpoint:", agentCoreEndpoint)
        console.log("Request headers:", headers)
        console.log("Request body:", JSON.stringify({ prompt: prompt.trim() }))

        let agentResponse: Response;
        try {
            agentResponse = await fetch(fullUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    prompt: prompt.trim(),
                }),
            });
        } catch (networkError) {
            console.error('Network error calling AgentCore:', networkError);
            throw new Error(`Network error: ${networkError instanceof Error ? networkError.message : 'Unknown network error'}`);
        }

        console.log('AgentCore response status:', agentResponse.status);
        console.log('AgentCore response headers:', Object.fromEntries(agentResponse.headers.entries()));

        if (!agentResponse.ok) {
            const errorText = await agentResponse.text();
            console.log('AgentCore error response:', errorText);
            throw new Error(`AgentCore returned ${agentResponse.status}: ${agentResponse.statusText} - ${errorText}`);
        }

        if (!agentResponse.body) {
            throw new Error('No response body from AgentCore');
        }

        reader = agentResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!isClosed) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            console.log('Received chunk from AgentCore:', chunk);
            buffer += chunk;

            // Process immediately by splitting on newlines and processing sequentially
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);

                console.log('Processing line:', line);
                if (!line || isClosed) continue;

                // Process SSE format
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        safeClose();
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
                    } catch {
                        // Ignore JSON parse errors
                    }
                } else {
                    // For direct JSON format responses
                    try {
                        const parsed = JSON.parse(line);
                        console.log('Parsed JSON from AgentCore:', parsed);
                        safeEnqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
                    } catch (parseError) {
                        console.log('Failed to parse JSON, treating as plain text:', line);
                        // If JSON parsing fails, treat as plain text
                        if (line.trim()) {
                            const textResponse = {
                                event: {
                                    contentBlockDelta: {
                                        delta: {
                                            text: line
                                        }
                                    }
                                }
                            };
                            safeEnqueue(encoder.encode(`data: ${JSON.stringify(textResponse)}\n\n`));
                        }
                    }
                }
            }
        }

        // Process remaining data in buffer
        if (buffer.trim() && !isClosed) {
            try {
                const parsed = JSON.parse(buffer);
                safeEnqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
            } catch {
                // Ignore JSON parse errors
            }
        }

        safeClose();
    } catch (error) {
        if (reader) {
            try {
                reader.releaseLock();
            } catch {
                // Continue even if reader release fails
            }
        }
        throw error;
    }
}

export async function POST(request: NextRequest) {
    console.log('=== Agent Stream API Called ===');

    try {
        // Validate ID token
        console.log('Validating ID token...');
        await validateIdToken(request);
        console.log('ID token validated successfully');

        // Get access token
        console.log('Extracting access token...');
        const accessToken = extractAccessToken(request);
        console.log('Access token extracted successfully');

        // Debug: Decode the access token to see its claims
        const decodedToken = decodeJWT(accessToken);
        console.log('Decoded access token claims:', JSON.stringify(decodedToken, null, 2));

        const { prompt, sessionId } = await request.json();
        console.log('Request payload:', { prompt: prompt?.substring(0, 50) + '...', sessionId });

        // Validate prompt
        if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
            console.log('Invalid prompt provided');
            return new Response('Bad Request: Empty or invalid prompt', { status: 400 });
        }

        // Environment check
        const agentCoreEndpoint = process.env.AGENT_CORE_ENDPOINT || 'arn:aws:bedrock-agentcore:us-west-2:779227446268:runtime/main-Uo5NHl7pal';
        console.log('AgentCore endpoint:', agentCoreEndpoint);
        console.log('All environment variables:', Object.keys(process.env).filter(key => key.includes('AGENT')));

        // Always try to call the real AgentCore endpoint
        console.log('Attempting to call AgentCore with endpoint:', agentCoreEndpoint);

        // Test: Add a simple test response first to verify streaming works
        console.log('Adding test response to verify streaming mechanism...');

        // Stream for communication with AgentCore Runtime
        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();

                try {
                    // First send a test message to verify streaming works
                    console.log('Sending test message...');
                    const testResponse = {
                        event: {
                            contentBlockDelta: {
                                delta: {
                                    text: "🔧 Testing connection to AgentCore... "
                                }
                            }
                        }
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(testResponse)}\n\n`));

                    // Small delay to see the test message
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Now try the real AgentCore call
                    await streamFromAgentCore(accessToken, prompt, sessionId, controller, agentCoreEndpoint);
                } catch (error) {
                    logError('AgentCore Communication', error);
                    const errorMessage = getErrorMessage(error);

                    try {
                        const errorResponse = {
                            event: {
                                contentBlockDelta: {
                                    delta: {
                                        text: `❌ AgentCore Error: ${errorMessage}`
                                    }
                                }
                            }
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorResponse)}\n\n`));
                        controller.close();
                    } catch (controllerError) {
                        console.warn('Controller operation failed:', controllerError);
                    }
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Token',
            },
        });
    } catch (error) {
        // Authentication error case
        if (error instanceof Error &&
            (error.message.includes('Missing') || error.message.includes('Invalid'))) {
            return new Response(`Unauthorized: ${error.message}`, { status: 401 });
        }

        // Other errors
        logError('SSE Endpoint', error);
        const errorMessage = getErrorMessage(error);
        return new Response(`Internal Server Error: ${errorMessage}`, { status: 500 });
    }
}
