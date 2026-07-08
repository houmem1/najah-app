// ── Configuration de la plateforme élève ──────────────────────────────
// Tout est public (clé anon + webhook public). Aucune donnée sensible ici.
window.CONFIG = {
  // Supabase (projet Carbon-Tracker)
  SUPA_URL: "https://quhfiakafaixjrgsxhpf.supabase.co",
  // Clé anon LEGACY (format JWT) — nécessaire aussi pour la fonction edge (verify_jwt)
  SUPA_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1aGZpYWthZmFpeGpyZ3N4aHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNjA3NjYsImV4cCI6MjA5NzczNjc2Nn0.rEX9COGXztFqRkQmUb9k_XsZDzVwoFQp2BAZwN8zstQ",
  // Tuteur IA « Najah IA » — webhook public du Chat Trigger n8n (mode streaming)
  N8N_CHAT: "https://slhoumem.app.n8n.cloud/webhook/dc1c9a30-9601-4728-94a2-020443311f94/chat",
  // Page de chat hébergée par n8n (repli plein écran garanti sans souci de CORS)
  N8N_CHAT_PAGE: "https://slhoumem.app.n8n.cloud/webhook/dc1c9a30-9601-4728-94a2-020443311f94/chat",
  // STT derja — webhook n8n (Groq Whisper large-v3 via credential n8n, aucune clé exposée)
  STT_FN: "https://slhoumem.app.n8n.cloud/webhook/stt-derja",
  // Premium (codes prépayés type carte de recharge)
  PREMIUM: {
    prixMois: "30 DT",
    prixTrimestre: "80 DT",
    // 0 = tuteur réservé au Premium (mettre p.ex. 3 pour offrir des questions découverte/jour)
    msgGratuitsParJour: 0,
    // Webhook n8n « Premium - Paiement Flouci » (déclaration du transfert Flouci).
    declareUrl: "https://slhoumem.app.n8n.cloud/webhook/premium-flouci",
    // Paiement Flouci par TRANSFERT : ton numéro Flouci (ou identifiant de réception).
    // L'élève t'envoie l'argent depuis son app Flouci, puis déclare le paiement.
    // ⚠️ REMPLIR avec ton numéro Flouci. Vide = bloc Flouci masqué.
    flouciNumero: "28 001 390",
    // Paiement D17 : numéro du portefeuille D17 (vide = option masquée).
    d17Numero: "",
    // Paiement Flouci API 100% automatique — nécessite un compte Flouci BUSINESS + jetons API.
    // Laisser false tant qu'on n'a pas de compte marchand. Passer à true après avoir posé
    // FLOUCI_APP_TOKEN / FLOUCI_APP_SECRET dans Supabase (Edge Functions → Secrets).
    flouciActif: false,
    flouciFn: "https://quhfiakafaixjrgsxhpf.supabase.co/functions/v1/flouci",
    // Lien d'achat générique (WhatsApp/site) — vide = texte générique
    contact: "",
  },
};
