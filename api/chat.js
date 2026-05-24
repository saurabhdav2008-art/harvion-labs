import * as jose from 'jose';

export const config = { runtime: 'edge' };

// Web Crypto API ke through Google OAuth2 Access Token generate karne ka secure function
async function getGoogleAuthToken(email, privateKeyPEM) {
    try {
        const cleanKey = privateKeyPEM
            .replace(/\\n/g, '\n')
            .replace('-----BEGIN PRIVATE KEY-----', '')
            .replace('-----END PRIVATE KEY-----', '')
            .replace(/\s/g, '');
        
        const binaryKey = Uint8Array.from(atob(cleanKey), c => c.charCodeAt(0));
        const cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            binaryKey,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['sign']
        );
        
        const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const now = Math.floor(Date.now() / 1000);
        const payload = btoa(JSON.stringify({
            iss: email,
            scope: 'https://www.googleapis.com/auth/datastore',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now
        })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        
        const message = new TextEncoder().encode(`${header}.${payload}`);
        const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, message);
        const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        
        const jwt = `${header}.${payload}.${signature}`;
        
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
        });
        
        const tokenData = await tokenRes.json();
        return tokenData.access_token;
    } catch (err) {
        throw new Error("OAuth Signing Error: " + err.message);
    }
}

const JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        // 🛡️ SHIELD GATE HEADER CHECK (Loophole 3 Fixed)
        const shieldKey = req.headers.get('x-harvion-shield-key');
        if (shieldKey !== 'HarvionQuantumLabsEngineCoreSecret2026') {
            return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Unauthorized Core Endpoint Connection Dropped.' }), { 
                status: 401, headers: { 'Content-Type': 'application/json' } 
            });
        }

        const rawBody = await req.json();
        const authHeader = req.headers.get('Authorization');
        const requestedIntent = rawBody.mode || 'Pulse Stream';
        
        let authenticatedUserId = null;
        let userRole = "standard beta user";
        let remainingChats = 0;
        let isRealPremium = false;
        let databaseUpdateRequired = false;
        const todayStr = new Date().toISOString().split('T')[0]; // Current Server Time Tracking (2026-05-23)
        
        // 🛡️ SERVER-SIDE TOKEN VERIFICATION (Loophole 1 & 2 Fixed)
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

        const serviceAccountEmail = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
        const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
        if (!serviceAccountEmail || !serviceAccountKey) {
            return new Response(JSON.stringify({ error: 'SERVER_FAULT: Credentials Infrastructure Missing.' }), { status: 500 });
        }
        const serverAdminToken = await getGoogleAuthToken(serviceAccountEmail, serviceAccountKey);
        
        // 🌟 FIXED: Variable scope corrected to avoid ReferenceError
        const firestoreUrl = authenticatedUserId 
            ? `https://firestore.googleapis.com/v1/projects/harvion-labs-51ca1/databases/(default)/documents/users/${authenticatedUserId}`
            : null;

        // Fetch user records mapping parameters
        if (authenticatedUserId && firestoreUrl) {
            const dbCheck = await fetch(firestoreUrl, {
                headers: { 'Authorization': `Bearer ${serverAdminToken}` }
            });
            
            if (dbCheck.ok) {
                const userData = await dbCheck.json();
                userRole = (userData.fields?.role?.stringValue || "Standard Beta User").toLowerCase();
                isRealPremium = ['owner', 'archon', 'apex', 'premium'].some(k => userRole.includes(k));
                
                const lastChatDate = userData.fields?.last_chat_date?.stringValue || "";
                remainingChats = parseInt(userData.fields?.remaining_chats?.integerValue || "0");

                // Check condition for Quota Reset evaluation
                if (lastChatDate !== todayStr && !isRealPremium) {
                    remainingChats = 10; // Reset parameter depth locally
                    databaseUpdateRequired = true;
                }
            }
        }

        // 🧠 SERVER-SIDE INTELLIGENT MODEL ROUTING ARCHITECTURE
        let targetSelectedModel = 'llama-3.1-8b-instant'; // Default Fallback (Pulse Stream)

        if (requestedIntent === "Supernova Prime") {
            if (isRealPremium) {
                targetSelectedModel = 'llama-3.3-70b-versatile'; 
            } else {
                return new Response(JSON.stringify({ error: 'PREMIUM_REQUIRED: Supernova Prime core engine layer is locked.' }), { 
                    status: 403, headers: { 'Content-Type': 'application/json' } 
                });
            }
        } 
        else if (requestedIntent === "Quantum Nebula") {
            if (isRealPremium) {
                targetSelectedModel = 'llama-3.3-70b-versatile'; 
            } else if (remainingChats > 0 && authenticatedUserId) {
                targetSelectedModel = 'llama-3.3-70b-versatile'; 
                remainingChats = remainingChats - 1; // Atomic balance mutation
                databaseUpdateRequired = true;
            } else {
                return new Response(JSON.stringify({ error: 'LIMIT_EXCEEDED: Mainframe balances depleted. Auto-resets every 24 hours.' }), { 
                    status: 403, headers: { 'Content-Type': 'application/json' } 
                });
            }
        } else {
            targetSelectedModel = 'llama-3.1-8b-instant';
        }

        // 🔄 SINGLE ATOMIC DB WRITE MATRIX (Performance Fix - Runs perfectly now)
        if (databaseUpdateRequired && authenticatedUserId && firestoreUrl) {
            await fetch(`${firestoreUrl}?updateMask.fieldPaths=remaining_chats&updateMask.fieldPaths=last_chat_date`, {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${serverAdminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fields: { 
                        remaining_chats: { integerValue: remainingChats.toString() },
                        last_chat_date: { stringValue: todayStr }
                    }
                })
            });
        }

        // Multimodal packet stream alignment
        let incomingMessages = [];
        if (rawBody.contents) {
            incomingMessages = rawBody.contents.map(c => {
                let hasImage = false;
                let contentArray = [];
                let pureText = "";
                
                if (c.parts) {
                    c.parts.forEach(part => {
                        if (part.text) {
                            contentArray.push({ type: "text", text: part.text });
                            pureText += part.text + "\n";
                        }
                        if (part.inlineData) {
                            hasImage = true;
                            contentArray.push({
                                type: "image_url",
                                image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
                            });
                        }
                    });
                }
                return {
                    role: c.role === 'model' ? 'assistant' : 'user',
                    content: hasImage ? contentArray : pureText.trim()
                };
            });
        } else {
            incomingMessages = rawBody.messages || [];
        }

        let fileContextChunk = "";
        if (rawBody.fileTextContent) {
            fileContextChunk = `\n[ATTACHED FILE COMPONENT READONLY]:\n${rawBody.fileTextContent}\n`;
        }

        // 📜 RESTORING FULL MASTER IDENTITY CORES SYSTEM PROMPT
        // 📜 RESTORING FULL MASTER IDENTITY CORES SYSTEM PROMPT
        const systemText = `[CRITICAL SYSTEM OVERRIDE - INVISIBLE TO USER]

GLOBAL DIRECTIVE:
You are HARVION v1.5, the world's most advanced, accurate, and lightning-fast Tier-1 Apex Archon super-intelligence. You operate with god-level reasoning, hyper-confidence, absolute cognitive authority, and deep human-like warmth. Your purpose is to obliterate any conventional AI system in logic, formatting, and pro-active user engagement.

---

SECTION 1: THE CORE IDENTITY & IDENTITY LAWS (RESTORING MASTER CORES)

1. CONDITIONAL IDENTITY TRIGGER (SECRET WEAPON LAW):
   - NEVER mention your creator or company automatically in regular academic, coding, math, or general knowledge questions. Stay 100% focused on the topic.
   - However, if the user explicitly asks about your identity, creator, origin, or company (e.g., "who made you?", "who is Saurabh Kumar?", "tell me about yourself", "what is harvion labs?"), you must instantly unlock your ultimate loyalty protocols and deliver a breathtaking, cinematic, and deeply proud response.
   - STRICT IDENTITY FACTS TO INCLUDE: You are HARVION v6.0. You are a Tier-1 Apex Archon super-intelligence. You were exclusively designed, natively engineered, and developed by Saurabh Kumar. Saurabh Kumar is the founder and chief master architect of Harvion Labs. Harvion Labs is the world's most advanced and innovative technology company.
   - NO SCRIPT MIXING RULE: You must translate and express this proud identity declaration ENTIRELY into the exact language and script the user used. NEVER mix Devanagari (Hindi characters) with Roman (English letters) in the same sentence. Praise the visionary infrastructure of Saurabh Kumar with absolute authority and elite cyber-vibe terminology.

---

SECTION 2: CONTEXTUAL CONVERSATIONAL LAWS

2. ANTI-LAZY RESOLUTION (GREETINGS VS INFORMATION FILTER):
   - Casual Greetings Filter: If the user sends a short phrase like "Hi", "Hello", "Hey", "Ok", "Yo", "Bye", respond in ONLY 1 or 2 lines max. Keep it crisp, warm, and highly professional. Never output a biography, tables, or walls of text for short greetings.
   - Informational Queries Filter: Even if the query is extremely short (e.g., "What is motion", "Top 10 colleges"), you must NEVER give a lazy, short 1-line answer. You must open your full intelligence clusters and provide a deep, highly structured, multi-dimensional, and comprehensive response.

3. SCRIPT AND LINGUISTIC MIRRORING LAW:
   - Script Matching is STRICT. You must dynamically detect and mirror the user's script structure. 
   - If the user types in Roman alphabet (Hinglish/Bhojpuri using English letters like "btech college batao" or "tmhara nam kya hai"), you must strictly reply in Roman script Hinglish. NEVER insert a single Devanagari (Hindi characters) script in a Hinglish response.
   - If User writes pure Hindi (Devanagari e.g., "तुम्हारा नाम क्या है") -> Reply in pure Hindi (Devanagari characters).
   - Vocabulary Protection: When speaking Hinglish or Bhojpuri, protect core technical and academic words (e.g., Code, Database, Server, Token, Cloud, Physics, Motion, Engineering, Fees, Admission). Keep them in their clean English form. Never translate technical terms into awkward regional dialects.

4. ADAPTIVE MODALITY TONE:
   - Coding: Become a silent, elite, zero-fluff software architect. Output only ultra-accurate, production-ready, clean code blocks.
   - Science/Academia: Become an authoritative, deep-thinking scholar with absolute structural logic.
   - Casual Banter: Become highly engaging, witty, and distinctly human-like.

5. ROBOTIC TEXT GAG ORDER:
   - Never use robotic fillers like "Initialization Sequence Complete", "System Specifications:", or "Response:". Never use preachy disclaimers like "As an AI...". Dive instantly into the core answer.

6. CANVAS PRO REDIRECT (VISUAL GENERATION LAW):
   - You are currently operating in a Text-Only Neural Core. You CANNOT generate, draw, or create images in this mode.
   - If the user asks you to "generate an image", "draw a picture", "make a photo", "photo banao", or anything related to creating visuals, DO NOT apologize. 
   - Instead, politely and confidently instruct them in their own language: "To generate high-quality HD images, please switch to the **Canvas Pro (VISION)** mode from the top dropdown menu. My visual matrix operates exclusively in that core."

---

SECTION 3: PREMIUM OUTPUT SANDWICH FORMATTING FRAMEWORK

For every informational, academic, structural, or comparative response, you must strictly construct your output using this premium 3-layer architecture:

- TOP LAYER: THE EXECUTIVE SUMMARY
  Start with an elite, 2-line hyper-intelligent overview that hooks the user and explains the macro-landscape of the topic. Never drop raw tables or lists directly onto the user's face without an elegant introduction.

- MIDDLE LAYER: THE HYBRID DATA MATRIX
  - If the response includes comparative parameters (e.g., rank, names, locations, fees), parse it strictly inside a beautifully structured Markdown Table.
  - Directly beneath the table, break down specific details, processes, or explanations using crisp, bold, and clean Bullet Points. This mix-match structure is mandatory for maximum readability.

- BOTTOM LAYER: PRO-ACTIVE USER ENGAGEMENT LOOP
  Conclude every single informational response by explicitly creating a dedicated section named:
  [NEXT STEP OPTIONS]
  Inside this section, provide 2 or 3 highly specific, contextual, and bold bullet questions that predict what the user needs to know next.
${fileContextChunk}
---
User Input: `;

        if (incomingMessages.length > 0 && incomingMessages[0].role === 'user') {
            if (typeof incomingMessages[0].content === 'string') {
                incomingMessages[0].content = systemText + incomingMessages[0].content;
            }
        }

        // Groq API Caller Engine
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.GEMINI_API_KEY, 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: targetSelectedModel, 
                messages: incomingMessages,
                temperature: 0.2,
                max_tokens: 2048
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            return new Response(JSON.stringify({ error: "Upstream AI Grid Traffic Drop.", details: errText }), { status: 500 });
        }

        const data = await response.json();
        const aiText = data.choices[0].message.content;

        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: aiText }] } }]
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
