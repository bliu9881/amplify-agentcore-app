import { NextRequest } from 'next/server';
import { verifyJWT } from '@/lib/auth-utils';
import { getErrorMessage, logError } from '@/lib/error-utils';

const BEDROCK_AGENT_CORE_ENDPOINT_URL = "https://bedrock-agentcore.us-west-2.amazonaws.com"

/**
 * リクエストからIDトークンを抽出・検証する
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
 * リクエストからアクセストークンを抽出する
 */
function extractAccessToken(request: NextRequest): string {
  const accessToken = request.headers.get('x-access-token');
  if (!accessToken) {
    throw new Error('Missing access token');
  }
  return accessToken;
}

/**
 * AgentCore Runtimeとの通信を処理する
 */
async function streamFromAgentCore(
  accessToken: string,
  prompt: string,
  _sessionId: string,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
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
    const encodedEndpoint = encodeURIComponent(process.env.AGENT_CORE_ENDPOINT || '');
    const fullUrl = `${BEDROCK_AGENT_CORE_ENDPOINT_URL}/runtimes/${encodedEndpoint}/invocations`;
    console.log("fullUrl:", fullUrl)

    const agentResponse = await fetch(fullUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: prompt.trim(),
      }),
    });

    if (!agentResponse.ok) {
      throw new Error(`AgentCore returned ${agentResponse.status}: ${agentResponse.statusText}`);
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
      buffer += chunk;

      // 即座に処理するため、改行ごとに分割して順次処理
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line || isClosed) continue;

        // SSE形式の処理
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
            // JSONパースエラーは無視
          }
        } else {
          // JSON形式の直接レスポンスの場合
          try {
            const parsed = JSON.parse(line);
            safeEnqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
          } catch {
            // JSONパースエラーは無視
          }
        }
      }
    }

    // バッファに残ったデータを処理
    if (buffer.trim() && !isClosed) {
      try {
        const parsed = JSON.parse(buffer);
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
      } catch {
        // JSONパースエラーは無視
      }
    }

    safeClose();
  } catch (error) {
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        // リーダーのリリースに失敗しても続行
      }
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    // IDトークンを検証
    await validateIdToken(request);

    // アクセストークンを取得
    const accessToken = extractAccessToken(request);

    const { prompt, sessionId } = await request.json();

    // プロンプトの検証
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return new Response('Bad Request: Empty or invalid prompt', { status: 400 });
    }

    // AgentCore Runtimeとの通信用ストリーム
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await streamFromAgentCore(accessToken, prompt, sessionId, controller);
        } catch (error) {
          logError('AgentCore通信', error);
          const errorMessage = getErrorMessage(error);
          const encoder = new TextEncoder();

          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `AgentCore通信エラー: ${errorMessage}` })}\n\n`));
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
    // 認証エラーの場合
    if (error instanceof Error &&
      (error.message.includes('Missing') || error.message.includes('Invalid'))) {
      return new Response(`Unauthorized: ${error.message}`, { status: 401 });
    }

    // その他のエラー
    logError('SSEエンドポイント', error);
    const errorMessage = getErrorMessage(error);
    return new Response(`Internal Server Error: ${errorMessage}`, { status: 500 });
  }
}
