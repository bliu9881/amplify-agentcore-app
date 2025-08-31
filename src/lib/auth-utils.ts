import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { logError } from './error-utils';
import outputs from '../../amplify_outputs.json';

// JWT検証器を作成（シングルトンパターン）
// amplify_outputs.jsonから設定を取得
const verifier = CognitoJwtVerifier.create({
    userPoolId: outputs.auth.user_pool_id,          // amplify_outputs.jsonから取得
    tokenUse: 'id',                                 // IDトークンを検証
    clientId: outputs.auth.user_pool_client_id,     // amplify_outputs.jsonから取得
});

// JWTトークンを検証する関数
export async function verifyJWT(token: string): Promise<boolean> {
    try {
        // トークンの署名、有効期限、発行者などを検証
        const payload = await verifier.verify(token);
        console.log('JWT検証成功:', payload.sub); // ユーザーID
        return true;
    } catch (error) {
        logError('JWT検証', error);
        return false;
    }
}