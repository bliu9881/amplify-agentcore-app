import { fetchAuthSession, fetchUserAttributes, getCurrentUser, signOut as amplifySignOut } from 'aws-amplify/auth';
import { useState, useEffect } from 'react';

interface AuthUser {
  userId: string;
  username: string;
  signInDetails?: {
    loginId?: string;
  };
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser as AuthUser);
      setIsAuthenticated(true);
    } catch {
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  const signOut = async () => {
    try {
      await amplifySignOut();
      setUser(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };
  
  // IDトークンを取得する関数（ユーザー認証用）
  const getIdToken = async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString();
    } catch {
      console.error('IDトークン取得エラー');
      return null;
    }
  };

  // アクセストークンを取得する関数（AgentCore Runtime認証用）
  const getAccessToken = async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString();
    } catch {
      console.error('アクセストークン取得エラー');
      return null;
    }
  };

  // 両方のトークンを取得する関数
  const getAuthTokens = async () => {
    try {
      const session = await fetchAuthSession();
      return {
        idToken: session.tokens?.idToken?.toString(),
        accessToken: session.tokens?.accessToken?.toString(),
      };
    } catch {
      console.error('認証トークン取得エラー');
      return { idToken: null, accessToken: null };
    }
  };

  // 後方互換性のため
  const getAuthToken = getIdToken;

  // ユーザー情報の詳細を取得する関数
  const getUserInfo = async () => {
    if (!user) return null;
    
    try {
      // Amplify Gen2では fetchUserAttributes を使用
      const attributes = await fetchUserAttributes();
      
      return {
        userId: user.userId,
        username: user.username,
        email: user.signInDetails?.loginId,
        // ユーザー属性（email, name等）
        attributes: attributes,
      };
    } catch {
      console.error('ユーザー属性取得エラー');
      return {
        userId: user.userId,
        username: user.username,
        email: user.signInDetails?.loginId,
        attributes: {},
      };
    }
  };

  return { 
    user, 
    signOut, 
    getAuthToken, // 後方互換性（IDトークン）
    getIdToken,
    getAccessToken,
    getAuthTokens,
    getUserInfo,
    isAuthenticated,
    checkAuthState
  };
}