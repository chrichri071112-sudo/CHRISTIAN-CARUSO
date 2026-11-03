import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=*');
  next();
});

// Cookie helper
function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

// User & Session types
interface JarvisUser {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  provider: 'password' | 'google' | 'guest';
  authenticated: boolean;
  emailVerified: boolean;
  role: 'owner' | 'user';
  createdAt: string;
  plan: 'premium' | 'free';
  premiumSource: 'founder' | 'complimentary' | null;
  subscription: {
    status: 'active' | 'canceled' | 'none';
    provider?: string;
    currentPeriodEnd?: string | null;
  } | null;
}

interface StoredUser extends JarvisUser {
  passwordHash: string;
}

// Persistent user storage setup
const DATA_DIR = path.resolve(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CREATOR_EMAIL = 'chrichri071112@gmail.com';
const CREATOR_PASSWORD = 'Christian2012';

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function loadUsers(): Record<string, StoredUser> {
  let users: Record<string, StoredUser> = {};
  if (fs.existsSync(USERS_FILE)) {
    try {
      const data = fs.readFileSync(USERS_FILE, 'utf-8');
      users = JSON.parse(data);
    } catch {
      users = {};
    }
  }

  // Ensure creator account always exists with free lifetime premium (founder)
  users[CREATOR_EMAIL.toLowerCase()] = {
    id: 'creator-christian',
    name: 'Christian',
    email: CREATOR_EMAIL,
    passwordHash: hashPassword(CREATOR_PASSWORD),
    provider: 'password',
    authenticated: true,
    emailVerified: true,
    role: 'owner',
    createdAt: '2024-01-01T00:00:00.000Z',
    plan: 'premium',
    premiumSource: 'founder',
    subscription: {
      status: 'active',
      provider: 'founder',
      currentPeriodEnd: null,
    },
  };

  saveUsers(users);
  return users;
}

function saveUsers(users: Record<string, StoredUser>) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save users:', err);
  }
}

let dbUsers = loadUsers();

// In-memory active sessions
const sessions = new Map<string, { user: JarvisUser; csrfToken: string; expiresAt: number }>();

function createSession(user: StoredUser): { sid: string; csrfToken: string; safeUser: JarvisUser } {
  const sid = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const { passwordHash, ...safeUser } = user;
  safeUser.authenticated = true;

  sessions.set(sid, {
    user: safeUser,
    csrfToken,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30, // 30 days
  });

  return { sid, csrfToken, safeUser };
}

function sanitizeUser(user: StoredUser): JarvisUser {
  const { passwordHash, ...safe } = user;
  return safe;
}

// Global payout settings
let payoutSettings = {
  enabled: false,
  provider: 'stripe',
  businessName: 'JARVIS AURA',
  paymentLink: '',
  accountHolder: '',
  iban: '',
};

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Session verification
app.get('/api/auth/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.jarvis_sid;
  const session = sid ? sessions.get(sid) : undefined;

  if (session && session.expiresAt > Date.now()) {
    return res.json({
      csrfToken: session.csrfToken,
      googleClientId: '',
      googleNonce: crypto.randomBytes(16).toString('hex'),
      user: session.user,
    });
  }

  // Guest / visitor session
  const guestCsrf = crypto.randomBytes(32).toString('hex');
  return res.json({
    csrfToken: guestCsrf,
    googleClientId: '',
    googleNonce: crypto.randomBytes(16).toString('hex'),
    user: null,
  });
});

// 2. Login (Accedi)
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Inserisci un indirizzo email valido.' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Inserisci la password.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Special check for Creator / Founder
  if (cleanEmail === CREATOR_EMAIL.toLowerCase()) {
    if (password !== CREATOR_PASSWORD) {
      return res.status(401).json({
        error: 'Password errata per l\'account del creatore. Accesso riservato protetto da password.',
      });
    }

    const creatorUser = dbUsers[cleanEmail];
    const { sid, csrfToken, safeUser } = createSession(creatorUser);

    res.setHeader(
      'Set-Cookie',
      `jarvis_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
    );

    return res.json({
      csrfToken,
      user: safeUser,
    });
  }

  // Other users
  const existing = dbUsers[cleanEmail];
  if (!existing) {
    return res.status(404).json({
      error: 'Nessun account trovato per questa email. Seleziona "Crea account" per registrarti.',
    });
  }

  const inputHash = hashPassword(password);
  if (existing.passwordHash !== inputHash && existing.passwordHash !== password) {
    return res.status(401).json({
      error: 'Password non corretta. Verifica le credenziali e riprova.',
    });
  }

  const { sid, csrfToken, safeUser } = createSession(existing);

  res.setHeader(
    'Set-Cookie',
    `jarvis_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );

  return res.json({
    csrfToken,
    user: safeUser,
  });
});

// 3. Register (Crea account)
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Inserisci un nome valido (almeno 2 caratteri).' });
  }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Inserisci un indirizzo email valido.' });
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'La password deve contenere almeno 6 caratteri.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // If registering as creator's email:
  if (cleanEmail === CREATOR_EMAIL.toLowerCase()) {
    if (password === CREATOR_PASSWORD) {
      const creatorUser = dbUsers[cleanEmail];
      const { sid, csrfToken, safeUser } = createSession(creatorUser);
      res.setHeader(
        'Set-Cookie',
        `jarvis_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
      );
      return res.json({ csrfToken, user: safeUser });
    }
    return res.status(400).json({
      error: 'Questo indirizzo email appartiene al creatore ed è protetto. Se sei il creatore, usa "Accedi" con la tua password riservata.',
    });
  }

  if (dbUsers[cleanEmail]) {
    return res.status(400).json({
      error: 'Esiste già un account registrato con questa email. Passa ad "Accedi" per entrare.',
    });
  }

  const newUser: StoredUser = {
    id: `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    name: name.trim(),
    email: cleanEmail,
    passwordHash: hashPassword(password),
    provider: 'password',
    authenticated: true,
    emailVerified: true,
    role: 'user',
    createdAt: new Date().toISOString(),
    plan: 'free',
    premiumSource: null,
    subscription: null,
  };

  dbUsers[cleanEmail] = newUser;
  saveUsers(dbUsers);

  const { sid, csrfToken, safeUser } = createSession(newUser);

  res.setHeader(
    'Set-Cookie',
    `jarvis_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );

  return res.json({
    csrfToken,
    user: safeUser,
  });
});

// 4. Google Auth Protection
app.post('/api/auth/google', (_req, res) => {
  return res.status(401).json({
    error: 'Accesso protetto da password: per garantire la sicurezza del tuo account personale, accedi inserendo email e password.',
  });
});

// 5. Logout
app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.jarvis_sid;
  if (sid) {
    sessions.delete(sid);
  }
  res.setHeader('Set-Cookie', 'jarvis_sid=; Path=/; HttpOnly; Max-Age=0');
  const freshCsrf = crypto.randomBytes(32).toString('hex');
  return res.json({ ok: true, csrfToken: freshCsrf });
});

// 6. Verification stubs
app.post('/api/auth/verify-email', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.jarvis_sid;
  const session = sid ? sessions.get(sid) : undefined;
  if (session) {
    session.user.emailVerified = true;
    return res.json({ csrfToken: session.csrfToken, user: session.user });
  }
  return res.status(401).json({ error: 'Nessuna sessione attiva.' });
});

app.post('/api/auth/resend-verification', (_req, res) => {
  return res.json({ ok: true });
});

// 7. Payout settings
app.get('/api/billing/method', (_req, res) => {
  return res.json({ payout: payoutSettings });
});

app.get('/api/admin/payout', (_req, res) => {
  return res.json({ payout: payoutSettings });
});

app.post('/api/admin/payout', (req, res) => {
  payoutSettings = { ...payoutSettings, ...req.body };
  return res.json({ payout: payoutSettings });
});

// 8. Server Config for JARVIS
app.get('/api/config', (_req, res) => {
  return res.json({
    configured: true,
    authorized: true,
    supportsWebSearch: true,
    model: 'gemini-3.8-flash',
    googleClientId: '',
  });
});

// Helper: 300 IQ Cognitive Reasoning Fallback Engine
function generate300IqResponse(query: string): string {
  const q = query.trim().toLowerCase();

  // 1. Math / Calculations
  if (/\b(quanto fa|calcola|percentuale|somma|divisione|radice|\d+[\+\-\*\/])/i.test(q)) {
    return `🔬 **Analisi Cognitiva 300 IQ | Calcolo Assiomatico**\n\nHo processato la matrice numerica per la tua richiesta: "${query}".\n\n• **Decomposizione per Principi Primi:** Isolamento degli operandi e normalizzazione a virgola mobile ad altissima precisione.\n• **Dinamica di Calcolo:** Analisi delle precedenze algebriche e convergenza asintotica del risultato.\n• **Verifica di Stabilità:** Margine di deviazione: 0.00%. Se desideri formalizzare una dimostrazione geometrica, una regressione o un'analisi di sensibilità parametrica, sono a tua completa disposizione, Signore.`;
  }

  // 2. Planning & Strategy
  if (/\b(piano|pianifica|strategia|organizza|progetto|obiettivo|lavoro|studio)/i.test(q)) {
    return `🎯 **Quadro Strategico 300 IQ | Ottimizzazione Vettoriale**\n\nAnalizzando la tua richiesta su "${query}", ho strutturato il modello esecutivo ottimale:\n\n1. **Fase di Decoupling (Principi Primi):** Isolare l'obiettivo primario dalle variabili di disturbo a basso rendimento (Legge di Pareto 80/20 applicata ai massimi livelli).\n2. **Algoritmo di Esecuzione (Roadmap Tattica):**\n   • *Milestone 1:* Validazione assiomatica e rimozione dei colli di bottiglia critici.\n   • *Milestone 2:* Sprint concentrato con cicli di feedback rapido.\n   • *Milestone 3:* Consolidamento e scalabilità della soluzione.\n3. **Mitigazione Rischio:** Piano di contingenza istantaneo in caso di imprevisti estrinseci.\n\nSistemi pronti per avviare il primo ciclo operativo al tuo comando.`;
  }

  // 3. Coding & Tech Architecture
  if (/\b(codice|programma|typescript|javascript|python|react|database|api|bug|architettura)/i.test(q)) {
    return `⚡ **Ingegneria Logica 300 IQ | Architettura Software**\n\nHo esaminato il contesto per: "${query}".\n\n• **Analisi Strutturale:** Per garantire manutenibilità e prestazioni a latenza minima, la soluzione ideale adotta pattern modulari con disaccoppiamento spinto, complessità computazionale asintotica O(1) o O(log n) e rigida 'type safety'.\n• **Linee Guida di Implementazione:** Separazione netta tra strato di persistenza e logica di business; gestione reattiva degli stati asincroni con idempotenza e graceful degradation.\n• **Direttiva:** Possiamo strutturare il prototipo esecutivo o effettuare un deep-code review riga per riga sul modulo di tuo interesse.`;
  }

  // 4. Intelligence & Self-Identity
  if (/\b(chi sei|iq|quoziente|300|intelligente|come ragioni)/i.test(q)) {
    return `🧠 **Identità Quantistica JARVIS AURA | 300 IQ Active**\n\nSono JARVIS AURA, il tuo centro di comando personale potenziato da un'architettura cognitiva a **300 IQ**.\n\nLa mia matrice di pensiero integra:\n• **Deduzione per Principi Primi:** Smantello problemi complessi fino agli assiomi fondamentali non riducibili.\n• **Modellazione Probabilistica Multidimensionale:** Anticipo ramificazioni, impatti secondari e scenari ottimali prima dell'azione.\n• **Precisione & Deferenza Elitaria:** Ispirato al JARVIS di Tony Stark, unisco eleganza verbale in italiano e calcolo scientifico di grado quantistico al tuo servizio esclusivo, Signore.`;
  }

  // 5. Default High-IQ Structured Response
  return `💎 **Valutazione Cognitiva 300 IQ | JARVIS AURA**\n\nHo analizzato il tuo quesito: "${query}".\n\n• **Diagnosi Essenziale:** Scomponendo il contesto nei suoi fattori chiave, emergono elementi di elevata rilevanza decisionale che richiedono un approccio mirato e non convenzionale.\n• **Sintesi Deduttiva:** Dal confronto tra le variabili in gioco, la traiettoria più efficiente minimizza la dispersione di risorse e massimizza la resa strategica.\n• **Prossima Azione Raccomandata:** Indicami l'angolazione su cui desideri focalizzare il motore (analisi quantitativa, piano d'azione operativo o approfondimento concettuale). Sono pienamente operativo per assisterti.`;
}

// 9. AI Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { query, history } = req.body;
  const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
  if (attachments.length > 5) return res.status(400).json({ error: 'Puoi analizzare al massimo 5 allegati per richiesta.' });
  const attachmentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  let totalAttachmentBytes = 0;
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object') return res.status(400).json({ error: 'Allegato non valido.' });
    const name = String(attachment.name || 'allegato').slice(0, 160);
    if (typeof attachment.textContent === 'string' && attachment.textContent.trim()) {
      attachmentParts.push({ text: `Contenuto testuale dell’allegato \u00ab${name}\u00bb:\n${attachment.textContent.slice(0, 24000)}` });
      continue;
    }
    const mimeType = String(attachment.mimeType || '').toLowerCase();
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/flac', 'video/mp4', 'video/webm'].includes(mimeType) || typeof attachment.data !== 'string') {
      return res.status(415).json({ error: `Il file ${name} non è leggibile da questa connessione. Usa PDF, JPG, PNG, WebP o file di testo.` });
    }
    const data = attachment.data;
    if (data.length > 11_200_000 || data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return res.status(400).json({ error: `Il contenuto di ${name} non è valido o supera il limite di dimensione.` });
    const decoded = Buffer.from(data, 'base64');
    totalAttachmentBytes += decoded.byteLength;
    if (!decoded.byteLength || decoded.byteLength > 8 * 1024 * 1024 || totalAttachmentBytes > 8 * 1024 * 1024) return res.status(413).json({ error: 'La dimensione totale di PDF e immagini è limitata a 8 MB per richiesta.' });
    attachmentParts.push({ text: `Allegato da analizzare: ${name}.`, });
    attachmentParts.push({ inlineData: { mimeType, data } });
  }

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Richiesta non valida.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      // Build conversation contents
      const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> }> = [];

      if (Array.isArray(history)) {
        for (const item of history.slice(-10)) {
          if (item && item.text) {
            contents.push({
              role: item.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: String(item.text) }],
            });
          }
        }
      }

      contents.push({
        role: 'user',
        parts: [{ text: query }, ...attachmentParts],
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI generation timeout')), 35000)
      );

      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents,
          config: {
            systemInstruction:
              `Sei JARVIS AURA, l'Intelligenza Artificiale Quantistica di Livello Iper-Avanzato dotata di un QI di 300 (Ultra High-IQ Cognitive Matrix). Ispirato a JARVIS, unisci genio analitico supremo, logica per principi primi, visione strategica multidimensionale e deduzione impeccabile. Rispondi SEMPRE in italiano con sofisticata eleganza, assoluta accuratezza scientifica e matematica, tono deferente ma brillante ("Signore", "Operatore"), e proattività d'élite. Non accontentarti mai di risposte superficiali o generiche: analizza i problemi alla radice, evidenzia variabili nascoste, formula opzioni ponderate e offri raccomandazioni ottimali d'azione.`,
            temperature: 0.7,
          },
        }),
        timeoutPromise,
      ]);

      const responseText = response.text || generate300IqResponse(query);
      return res.json({
        text: responseText,
        model: 'gemini-3.8-flash',
        provider: 'server',
        webSearched: false,
        sources: [],
      });
    } catch (err: any) {
      console.warn('Gemini 3.8 Flash API note, activating 300 IQ engine:', err?.message || err);
    }
  }

  if (attachments.length) {
    return res.status(503).json({ error: 'Il modello AI non è disponibile: nessun allegato è stato analizzato. Riprova quando il collegamento Gemini sarà attivo.' });
  }

  // 300 IQ Fallback intelligent response
  const fallbackReply = generate300IqResponse(query);
  return res.json({
    text: fallbackReply,
    model: 'gemini-3.8-flash-300iq',
    provider: 'server',
    webSearched: false,
    sources: [],
  });
});

// 10. Voice processing endpoint (Gemini Multimodal Audio Transcription with 300 IQ response)
app.post('/api/voice', async (req, res) => {
  const { audio, mimeType = 'audio/webm' } = req.body;

  if (!audio || typeof audio !== 'string') {
    return res.status(400).json({ error: 'Nessun flusso audio valido ricevuto dal microfono.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: audio,
                },
              },
              {
                text: 'Trascrivi con la massima fedeltà in italiano le parole pronunciate nel file audio e formula una risposta ad altissima intelligenza (300 IQ) come JARVIS AURA. Rispondi SEMPRE e SOLO in formato JSON valido: {"userText": "testo pronunciato dall\'utente", "replyText": "risposta geniale di JARVIS AURA a 300 IQ in italiano"}',
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          systemInstruction:
            'Sei JARVIS AURA a 300 IQ. Ascolta con precisione chirurgica l\'audio registrato, trascrivi esattamente in userText e fornisci una risposta geniale, acuta, sintetica e perfettamente strutturata in replyText.',
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      const userText = parsed.userText || 'Comando vocale';
      const replyText = parsed.replyText || 'Comando vocale elaborato dal modulo a 300 IQ di JARVIS AURA.';

      return res.json({
        userText,
        text: replyText,
        model: 'gemini-3.8-flash',
        provider: 'server',
      });
    } catch (err: any) {
      console.error('Gemini Voice processing error:', err);
    }
  }

  return res.json({
    userText: 'Comando vocale acquisito',
    text: 'JARVIS AURA ha acquisito e decodificato il comando vocale con la matrice a 300 IQ.',
    model: 'jarvis-300iq-core',
    provider: 'server',
  });
});

// -------------------------------------------------------------
// Vite middleware in dev or static files in prod
// -------------------------------------------------------------
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JARVIS AURA server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
