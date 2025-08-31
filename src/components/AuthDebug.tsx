'use client'

import { useAuthenticator } from '@aws-amplify/ui-react';

export default function AuthDebug() {
  const { user, authStatus } = useAuthenticator();
  
  return (
    <div className="p-4 bg-yellow-100 border border-yellow-400 rounded mb-4">
      <h3 className="font-bold">Auth Debug Info:</h3>
      <p><strong>Auth Status:</strong> {authStatus}</p>
      <p><strong>User exists:</strong> {user ? 'Yes' : 'No'}</p>
      {user && (
        <div>
          <p><strong>Username:</strong> {user.username}</p>
          <p><strong>User ID:</strong> {user.userId}</p>
          <p><strong>Sign-in details:</strong> {JSON.stringify(user.signInDetails)}</p>
        </div>
      )}
    </div>
  );
}