'use client'

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

export default function SimpleTest() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { getAuthTokens } = useAuth();

  const testAPI = async () => {
    if (!message.trim()) return;
    
    setLoading(true);
    setError('');
    setResponse('');
    
    try {
      console.log('Getting auth tokens...');
      const { idToken, accessToken } = await getAuthTokens();
      
      if (!idToken || !accessToken) {
        throw new Error('Failed to get authentication tokens');
      }
      
      console.log('Calling API with message:', message);
      const res = await fetch('/api/agent-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
          'X-Access-Token': accessToken,
        },
        body: JSON.stringify({ prompt: message }),
      });
      
      console.log('Response status:', res.status);
      console.log('Response headers:', Object.fromEntries(res.headers.entries()));
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      
      const responseText = await res.text();
      setResponse(responseText);
      
    } catch (err) {
      console.error('Test API error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Simple API Test</h1>
      
      <div className="mb-4">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Enter test message"
          className="w-full px-4 py-2 border rounded"
        />
      </div>
      
      <button
        onClick={testAPI}
        disabled={loading || !message.trim()}
        className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
      >
        {loading ? 'Testing...' : 'Test API'}
      </button>
      
      {error && (
        <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          <strong>Error:</strong> {error}
        </div>
      )}
      
      {response && (
        <div className="mt-4 p-4 bg-green-100 border border-green-400 rounded">
          <strong>Response:</strong>
          <pre className="mt-2 whitespace-pre-wrap">{response}</pre>
        </div>
      )}
    </div>
  );
}