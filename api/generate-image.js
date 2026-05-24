import * as jose from 'jose';

export const config = { runtime: 'edge' };

const JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

// 🚀 ULTRA-FAST & STACK-SAFE BASE64 ENCODER (Fixes Vercel V8 Isolate Isolate Stack Overflow Panic)
function uint8ArrayToBase64(bytes) {
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let result = "";
    const len = bytes.length;
    for (let i = 0; i < len; i += 3) {
        const b1 = bytes[i];
        const b2 = i + 1 < len ? bytes[i + 1] : 0;
        const b3 = i + 2 < len ? bytes[i + 2] : 0;

        result += abc[b1 >> 2];
        result += abc[((b1 & 3) << 4) | (b2 >> 4)];
        result += i + 1 < len ? abc[((b2 & 15) << 2) | (b3 >> 6)] : "=";
        result += i + 2 < len ? abc[b3 & 63] : "=";
    }
    return result;
}

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        // 🛡️ 1. SHIELD GATE HEADER CHECK (Your Core Security Layer)
        const shieldKey = req.headers.get('x-harvion-shield-key');
        if (shieldKey !== 'HarvionQuantumLabsEngineCoreSecret2026') {
            return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Unauthorized Core Endpoint Connection Dropped.' }), { 
                status: 401, headers: { 'Content-Type': 'application/json' } 
            });
        }

        const rawBody = await req.json();
        const authHeader = req.headers.get('Authorization');
        const userPrompt = rawBody.prompt;

        if (!userPrompt) {
            return new Response(JSON.stringify({ error: 'Validation Error: Prompt parameter is missing.' }), { status: 400 });
        }
        
        let authenticatedUserId = null;
        
        // 🛡️ 2. SERVER-SIDE TOKEN VERIFICATION (Anti-Abuse Check)
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const rawToken = authHeader.split('Bearer ')[1];
            try {
                const { payload } = await jose.jwtVerify(rawToken, JWKS, {
                    audience: 'harvion-labs-51ca1',
                    issuer: 'https://securetoken.google.com/harvion-labs-51ca1'
                });
                authenticatedUserId = payload.sub; 
            } catch (jwtError) {
                return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Cryptographic Token Tampering Mismatch.' }), { 
                    status: 403, headers: { 'Content-Type': 'application/json' } 
                });
            }
        }

        // 🔑 Hugging Face Key Verification
        const hfApiKey = process.env.HF_TOKEN;
        if (!hfApiKey) {
            return new Response(JSON.stringify({ error: 'SERVER_FAULT: Hugging Face API Token Missing in .env.' }), { status: 500 });
        }

        // 🎨 3. HUGGING FACE INFERENCE API (Flux.1 Schnell Model)
        const hfResponse = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${hfApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                inputs: userPrompt 
            })
        });

        if (!hfResponse.ok) {
            const errText = await hfResponse.text();
            return new Response(JSON.stringify({ error: "Upstream Hugging Face Generation Drop.", details: errText }), { status: 500 });
        }

        // 🔄 4. STACK-SAFE LINER BUFFER CONVERSION (0ms Stack Overhead)
        const arrayBuffer = await hfResponse.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        const base64Image = uint8ArrayToBase64(bytes);
        const finalImageUrl = `data:image/jpeg;base64,${base64Image}`;

        // 🚀 Output returning system matching frontend contract
        return new Response(JSON.stringify({
            imageUrl: finalImageUrl
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, headers: { 'Content-Type': 'application/json' } 
        });
    }
}
