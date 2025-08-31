'use client'

import { useState } from 'react';
import { useSSEChat } from '@/hooks/useSSEChat';
import { useAuthenticator } from '@aws-amplify/ui-react';
import AuthDebug from './AuthDebug';

export default function ChatTest() {
  const [input, setInput] = useState('');
  const { messages, isLoading, error, sendMessage, clearMessages } = useSSEChat();
  const { user, signOut, authStatus } = useAuthenticator();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input);
      setInput('');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <AuthDebug />
      
      {!user ? (
        <div className="text-center">
          <p>Please complete authentication to access the chat.</p>
          <p>Auth Status: {authStatus}</p>
        </div>
      ) : (

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="mb-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">AgentCore Chat Test</h1>
        <button 
          onClick={signOut}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Sign Out
        </button>
      </div>
      
      <div className="mb-4 p-4 bg-gray-100 rounded">
        <p><strong>User:</strong> {user.username}</p>
        <p><strong>Email:</strong> {user.signInDetails?.loginId}</p>
      </div>

      <div className="mb-4">
        <button 
          onClick={clearMessages}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
        >
          Clear Messages
        </button>
      </div>

      <div className="mb-4 h-96 overflow-y-auto border p-4 bg-white rounded">
        {messages.length === 0 && (
          <p className="text-gray-500">No messages yet. Send a message to test AgentCore integration.</p>
        )}
        {messages.map((message, index) => (
          <div key={index} className="mb-2 p-2 bg-blue-50 rounded">
            <strong>AI:</strong> {message}
          </div>
        ))}
        {isLoading && (
          <div className="mb-2 p-2 bg-yellow-50 rounded">
            <strong>AI:</strong> <em>Thinking...</em>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          <strong>Error:</strong> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          className="flex-1 px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          Send
        </button>
      </form>
      )}
    </div>
  );
}