// ── Configuration de la plateforme élève ──────────────────────────────
// Tout est public (clé anon + webhook public). Aucune donnée sensible ici.
window.CONFIG = {
  // Contenu : fichiers JSON statiques publiés avec le site (dossier data/)
  DATA: "data/",
  // API n8n : activation des codes Premium (tables de données n8n)
  API: "https://slhoumem.app.n8n.cloud/webhook/najah-api",
  // Tuteur IA « Najah IA » — webhook public du Chat Trigger n8n (mode streaming)
  N8N_CHAT: "https://slhoumem.app.n8n.cloud/webhook/dc1c9a30-9601-4728-94a2-020443311f94/chat",
  // Page de chat hébergée par n8n (repli plein écran garanti sans souci de CORS)
  N8N_CHAT_PAGE: "https://slhoumem.app.n8n.cloud/webhook/dc1c9a30-9601-4728-94a2-020443311f94/chat",
  // STT derja — webhook n8n (Groq Whisper large-v3 via credential n8n, aucune clé exposée)
  STT_FN: "https://slhoumem.app.n8n.cloud/webhook/stt-derja",
  // Premium (codes prépayés type carte de recharge)
  PREMIUM: {
    prixMois: "20 DT",
    prixTrimestre: "50 DT",
    // 0 = tuteur réservé au Premium (mettre p.ex. 3 pour offrir des questions découverte/jour)
    msgGratuitsParJour: 0,
    // Webhook n8n « Premium - Paiement Flouci » (déclaration du transfert Flouci).
    declareUrl: "https://slhoumem.app.n8n.cloud/webhook/premium-flouci",
    // Paiement Flouci par TRANSFERT : ton numéro Flouci (ou identifiant de réception).
    // L'élève t'envoie l'argent depuis son app Flouci, puis déclare le paiement.
    // ⚠️ REMPLIR avec ton numéro Flouci. Vide = bloc Flouci masqué.
    flouciNumero: "28 001 390",
    // Paiement IZI (Banque Zitouna) par TRANSFERT : ton numéro/identifiant IZI de réception.
    // L'élève t'envoie l'argent depuis son app IZI, puis déclare le paiement.
    // ⚠️ REMPLIR avec ton numéro IZI. Vide = bloc IZI masqué.
    iziNumero: "28 001 390",
    // Paiement D17 : numéro du portefeuille D17 (vide = option masquée).
    d17Numero: "",
    // Paiement en ligne automatique : non disponible (transfert Flouci/IZI + validation).
    flouciActif: false,
    // Lien d'achat générique (WhatsApp/site) — vide = texte générique
    contact: "",
  },
};
