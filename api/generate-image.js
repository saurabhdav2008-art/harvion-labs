import * as jose from 'jose';
import { Buffer } from 'node:buffer'; // 🚀 NATIVE ULTRA-FAST CONVERTER ADDED

export const config = { runtime: 'edge' };

const JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        // 🛡️ 1. SHIELD GATE HEADER CHECK
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
        
        // 🛡️ 2. SERVER-SIDE TOKEN VERIFICATION
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

        // 🔄 4. NATIVE BUFFER CONVERSION (0ms CPU Time, Crash-Proof!)
        const arrayBuffer = await hfResponse.arrayBuffer();
        const base64Image = Buffer.from(arrayBuffer).toString('base64');
        const finalImageUrl = `data:image/jpeg;base64,${base64Image}`;

        // 🚀 Final Output to App
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
