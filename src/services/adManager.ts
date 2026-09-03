import { Ad, AdCampaign, AdConfig, AdEventTrack, AdSessionState, AdType, Advertiser, Diagnosis, SubscriptionPlan } from "../types";

// ---------------------------------------------------------------------------
// VOCAL ADVERTISING OFFERS & DUAL VOICE PROMPTS (100% VOCAL AD MANAGER)
// ---------------------------------------------------------------------------

export interface VocalAdOffer {
  id: string;
  title: string;
  priceTag: string;
  type: "SANS_TABLETTE" | "AVEC_TABLETTE" | "COMBINE";
  vocalScript: string;
  adVoicePrompt: string;
}

export interface PriorityAudioAd {
  id: string;
  title: string;
  mp3Url: string;
  vocalScript: string;
  adVoicePrompt: string;
  priority: number; // 1 = High priority
  timestamp: number;
}

export const SHORT_AUDIO_ADS_MP3: PriorityAudioAd[] = [
  {
    id: "MP3-AD-80K",
    title: "Scanner DiagAssist 80 000 FCFA",
    mp3Url: "https://actions.google.com/sounds/v1/vehicles/car_pass_by.ogg",
    vocalScript: "Petite information commerciale : découvrez nos scanners automobiles sans tablette à partir de 80 000 francs CFA.",
    adVoicePrompt: "Adopte un ton commercial dynamique pour annoncer le scanner sans tablette à 80 000 FCFA.",
    priority: 1,
    timestamp: Date.now()
  },
  {
    id: "MP3-AD-100K",
    title: "Scanner DiagAssist 100 000 FCFA",
    mp3Url: "https://actions.google.com/sounds/v1/vehicles/car_door_open_close.ogg",
    vocalScript: "Pour une solution de diagnostic complète avec tablette, découvrez nos équipements à partir de 100 000 francs CFA.",
    adVoicePrompt: "Adopte un ton commercial dynamique pour annoncer le scanner avec tablette à 100 000 FCFA.",
    priority: 1,
    timestamp: Date.now()
  }
];

export const VOCAL_DEMO_OFFERS: VocalAdOffer[] = [
  {
    id: "VOCAL-OFFER-80K",
    title: "Scanner automobile sans tablette",
    priceTag: "80 000 FCFA",
    type: "SANS_TABLETTE",
    vocalScript: "Petite information commerciale : si vous souhaitez vous équiper pour vos prochains diagnostics, découvrez nos scanners automobiles sans tablette, utilisables avec un smartphone compatible, à partir de 80 000 francs CFA.",
    adVoicePrompt: "Adopte un ton commercial, dynamique, professionnel et haut de gamme (voix publicitaire) pour prononcer l'annonce suivante : 'Petite information commerciale : si vous souhaitez vous équiper pour vos prochains diagnostics, découvrez nos scanners automobiles sans tablette à partir de 80 000 francs CFA.' Puis bascule immédiatement vers ta voix de diagnostic calme et technique.",
  },
  {
    id: "VOCAL-OFFER-100K",
    title: "Scanner automobile avec tablette",
    priceTag: "100 000 FCFA",
    type: "AVEC_TABLETTE",
    vocalScript: "Pour une solution de diagnostic plus complète, découvrez également nos scanners automobiles avec tablette, disponibles à partir de 100 000 francs CFA.",
    adVoicePrompt: "Adopte un ton commercial, dynamique, professionnel et haut de gamme (voix publicitaire) pour prononcer l'annonce suivante : 'Pour une solution de diagnostic plus complète, découvrez également nos scanners automobiles avec tablette, disponibles à partir de 100 000 francs CFA.' Puis bascule immédiatement vers ta voix de diagnostic calme et technique.",
  },
  {
    id: "VOCAL-OFFER-COMBINED",
    title: "Gamme complète Scanners DiagAssist",
    priceTag: "80 000 / 100 000 FCFA",
    type: "COMBINE",
    vocalScript: "Si vous souhaitez vous équiper pour vos prochains diagnostics, des scanners sans tablette sont disponibles à partir de 80 000 francs CFA, et des solutions avec tablette à partir de 100 000 francs CFA.",
    adVoicePrompt: "Adopte un ton commercial, dynamique, professionnel et haut de gamme (voix publicitaire) pour prononcer l'annonce suivante : 'Si vous souhaitez vous équiper pour vos prochains diagnostics, des scanners sans tablette sont disponibles à partir de 80 000 francs CFA, et des solutions avec tablette à partir de 100 000 francs CFA.' Puis bascule immédiatement vers ta voix de diagnostic calme et technique.",
  },
];
export const DEFAULT_AD_CONFIG: AdConfig = {
  enabled: false,
  maxAdsPerSession: 0,
  minIntervalBetweenAds: 999999999, // Disable ads
  showBeforeSession: false,
  showDuringLive: false,
  showAfterDiagnosis: false,
  allowFullscreen: false, // Strict protection: 100% vocal ads only
  allowBanner: false,     // Strict protection: 100% vocal ads only
  allowSponsoredContent: false, // Strict protection: 100% vocal ads only
};

// ---------------------------------------------------------------------------
// DEFAULT ANNOUNCERS CATALOG
// ---------------------------------------------------------------------------
export const INITIAL_ADVERTISERS: Advertiser[] = [
  {
    id: "ADV-001",
    name: "Autel West Africa",
    logo: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=100&h=100&fit=crop",
    phone: "+225 07 00 11 22",
    website: "https://www.autel.com",
    active: true,
  },
  {
    id: "ADV-002",
    name: "ThinkCar & ThinkDiag Ci",
    logo: "https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?w=100&h=100&fit=crop",
    phone: "+225 05 88 99 00",
    website: "https://mythinkcar.com",
    active: true,
  },
  {
    id: "ADV-003",
    name: "Bosch Automotive Abidjan",
    logo: "https://images.unsplash.com/photo-1617814076367-b759c7d7e738?w=100&h=100&fit=crop",
    phone: "+225 27 21 00 00",
    website: "https://www.bosch.ci",
    active: true,
  },
  {
    id: "ADV-004",
    name: "CFAO Motors pièces & Outillage",
    logo: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=100&h=100&fit=crop",
    phone: "+225 27 21 25 25",
    website: "https://www.cfao-group.com",
    active: true,
  },
];

// ---------------------------------------------------------------------------
// DEFAULT CAMPAIGNS CATALOG
// ---------------------------------------------------------------------------
export const INITIAL_CAMPAIGNS: AdCampaign[] = [
  {
    id: "CMP-101",
    advertiserId: "ADV-002",
    name: "Promotion ThinkDiag 2 Bluetooth",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    budget: 500000,
    active: true,
    targetCategories: ["scanner", "diagnostic", "obd"],
  },
  {
    id: "CMP-102",
    advertiserId: "ADV-003",
    name: "Batteries Bosch Heavy Duty 12V",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    budget: 350000,
    active: true,
    targetCategories: ["battery", "batterie", "charge", "demarreur"],
  },
  {
    id: "CMP-103",
    advertiserId: "ADV-001",
    name: "Scanner Professionnel Autel MaxiSYS",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    budget: 800000,
    active: true,
    targetCategories: ["scanner", "pro", "autel"],
  },
  {
    id: "CMP-104",
    advertiserId: "ADV-004",
    name: "Kit Freinage & Disques Haute Perf",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    budget: 250000,
    active: true,
    targetCategories: ["frein", "brake", "plaquettes", "disque"],
  },
];

// ---------------------------------------------------------------------------
// INITIAL ADS CATALOG
// ---------------------------------------------------------------------------
export const INITIAL_ADS: Ad[] = [
  {
    id: "AD-001",
    campaignId: "CMP-101",
    advertiserId: "ADV-002",
    advertiserName: "ThinkCar CI",
    type: "BANNER",
    title: "Scanner ThinkDiag 2 - CAN FD",
    description: "Valise Bluetooth multimarques pour Android & iOS. Codage ECU & Reset huile.",
    imageUrl: "https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?w=300&h=200&fit=crop",
    priceTag: "65 000 FCFA",
    callToAction: "Commander via WhatsApp",
    targetUrl: "https://wa.me/22505889900?text=Bonjour,%20je%20souhaite%20commander%20le%20ThinkDiag%202",
    categories: ["scanner", "diagnostic", "obd", "general"],
    active: true,
    badgeText: "SPONSORED",
  },
  {
    id: "AD-002",
    campaignId: "CMP-102",
    advertiserId: "ADV-003",
    advertiserName: "Bosch Auto",
    type: "RECOMMENDED_PRODUCT",
    title: "Booster & Tester de Batterie Bosch S4",
    description: "Recharge rapide 12V 74Ah. Garanti 24 mois contre le sulfatage tropical.",
    imageUrl: "https://images.unsplash.com/photo-1617814076367-b759c7d7e738?w=300&h=200&fit=crop",
    priceTag: "48 000 FCFA",
    callToAction: "Découvrir le produit",
    targetUrl: "https://www.bosch.ci",
    categories: ["battery", "batterie", "alternateur", "charge"],
    active: true,
    badgeText: "PRODUIT RECOMMANDÉ",
  },
  {
    id: "AD-003",
    campaignId: "CMP-103",
    advertiserId: "ADV-001",
    advertiserName: "Autel West Africa",
    type: "FULLSCREEN",
    title: "Autel MaxiCOM MK808S - Version 2026",
    description: "Diagnostic tous systèmes, 36+ fonctions de service, processeur ultra-rapide.",
    imageUrl: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=500&h=300&fit=crop",
    priceTag: "220 000 FCFA",
    callToAction: "Profiter de l'offre atelier",
    targetUrl: "https://www.autel.com",
    categories: ["scanner", "diagnostic", "general"],
    active: true,
    badgeText: "OFFRE SPÉCIALE ATELIER",
  },
  {
    id: "AD-004",
    campaignId: "CMP-104",
    advertiserId: "ADV-004",
    advertiserName: "CFAO Motors",
    type: "SPONSORED_PRODUCT",
    title: "Kit Plaquettes & Liquide de Frein Brembo",
    description: "Coefficients de friction renforcés pour climats chauds et trafic dense.",
    imageUrl: "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=300&h=200&fit=crop",
    priceTag: "32 000 FCFA",
    callToAction: "Voir la compatibilité",
    targetUrl: "https://www.cfao-group.com",
    categories: ["frein", "brake", "plaquettes", "disque"],
    active: true,
    badgeText: "SÉCURITÉ FREINAGE",
  },
  {
    id: "AD-005",
    campaignId: "CMP-101",
    advertiserId: "ADV-002",
    advertiserName: "ThinkCar CI",
    type: "BANNER",
    title: "Oscilloscope Automobile USB 4 Voies",
    description: "Analyse en direct des signaux capteur PMH, injecteurs et bus CAN.",
    imageUrl: "https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=300&h=200&fit=crop",
    priceTag: "85 000 FCFA",
    callToAction: "Voir l'outil",
    targetUrl: "https://mythinkcar.com",
    categories: ["engine", "moteur", "electronique", "capteur"],
    active: true,
    badgeText: "SÉLECTION PRO",
  },
];

// ---------------------------------------------------------------------------
// ABSOLUTE RULE: DIAGNOSTIC & GEMINI LIVE FREQUENCY FILTER
// ---------------------------------------------------------------------------
export function canDisplayAd(sessionState: AdSessionState, adType: AdType): boolean {
  switch (sessionState) {
    case "idle":
      return true; // OK for pre-session banners/fullscreen
    case "connecting":
      return false; // STRICT: No ads during initial WS handshake
    case "live":
      return adType === "BANNER"; // ONLY non-intrusive bottom banners allowed during Live
    case "analyzing":
      return false; // STRICT: No ads while analyzing image / DTCs
    case "waiting_user":
      return adType === "BANNER"; // OK for subtle banner
    case "testing":
      return false; // STRICT: No ads during active component test
    case "completed":
      return true; // OK for post-diagnostic recommended products
    case "error":
      return adType === "BANNER";
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// CENTRAL AD MANAGER CLASS
// ---------------------------------------------------------------------------
export class AdManager {
  private config: AdConfig;
  private advertisers: Advertiser[];
  private campaigns: AdCampaign[];
  private ads: Ad[];
  private adsShownInSession: number = 0;
  private lastAdTimestamp: number = 0;
  private currentActiveAd: Ad | null = null;
  private events: AdEventTrack[] = [];
  private sessionId: string;

  // Audio ad priority queue & Gemini playback state
  private audioAdQueue: PriorityAudioAd[] = [];
  private isGeminiSpeaking: boolean = false;
  private audioPlaybackHandler: ((ad: PriorityAudioAd) => void) | null = null;

  constructor(
    customConfig?: Partial<AdConfig>,
    customAdvertisers?: Advertiser[],
    customCampaigns?: AdCampaign[],
    customAds?: Ad[]
  ) {
    this.config = { ...DEFAULT_AD_CONFIG, ...customConfig };
    this.advertisers = customAdvertisers || INITIAL_ADVERTISERS;
    this.campaigns = customCampaigns || INITIAL_CAMPAIGNS;
    this.ads = customAds || INITIAL_ADS;
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Load persisted events if available
    try {
      const savedEvents = localStorage.getItem("diagassist_ad_events");
      if (savedEvents) {
        this.events = JSON.parse(savedEvents).map((e: any) => ({
          ...e,
          timestamp: new Date(e.timestamp),
        }));
      }
    } catch {
      this.events = [];
    }
  }

  // Check if ads can be shown considering plan, config, frequency limits, and state
  public canShowAd(
    sessionState: AdSessionState,
    adType: AdType,
    userPlan?: SubscriptionPlan
  ): boolean {
    // Rule 1: Premium users have NO ads
    if (userPlan === "premium" || userPlan === "lite") {
      // Free trial and PAYG get ads, Premium and Lite turn off intrusive ads
      if (userPlan === "premium") return false;
    }

    // Rule 2: Ad manager disabled globally
    if (!this.config.enabled) return false;

    // Rule 3: Session state filter
    if (!canDisplayAd(sessionState, adType)) return false;

    // Rule 4: Format checks
    if (adType === "FULLSCREEN" && !this.config.allowFullscreen) return false;
    if (adType === "BANNER" && !this.config.allowBanner) return false;
    if (
      (adType === "RECOMMENDED_PRODUCT" || adType === "SPONSORED_PRODUCT") &&
      !this.config.allowSponsoredContent
    ) {
      return false;
    }

    // Rule 5: Frequency cap per session
    if (this.adsShownInSession >= this.config.maxAdsPerSession) return false;

    // Rule 6: Minimum interval check
    const now = Date.now();
    if (now - this.lastAdTimestamp < this.config.minIntervalBetweenAds) return false;

    return true;
  }

  // Select the most contextually relevant active ad
  public getContextualAd(
    sessionState: AdSessionState,
    preferredType: AdType = "BANNER",
    diagnosis?: Diagnosis | null,
    userPlan?: SubscriptionPlan
  ): Ad | null {
    if (!this.canShowAd(sessionState, preferredType, userPlan)) {
      return null;
    }

    // Filter active ads
    let candidateAds = this.ads.filter((a) => a.active && a.type === preferredType);

    if (candidateAds.length === 0) {
      // Fallback to any active ad matching session state rule
      candidateAds = this.ads.filter(
        (a) => a.active && canDisplayAd(sessionState, a.type)
      );
    }

    if (candidateAds.length === 0) return null;

    // Contextual matching if diagnosis is present
    if (diagnosis) {
      const diagText = `${diagnosis.brandModelInfo} ${diagnosis.explanationText} ${diagnosis.probableCauses.join(" ")} ${diagnosis.dtcCodesDetected.map((c) => `${c.code} ${c.description}`).join(" ")}`.toLowerCase();

      const matchedAd = candidateAds.find((ad) =>
        ad.categories.some((cat) => diagText.includes(cat.toLowerCase()))
      );

      if (matchedAd) return matchedAd;
    }

    // Fallback: Pick random active candidate
    const randomIndex = Math.floor(Math.random() * candidateAds.length);
    return candidateAds[randomIndex];
  }

  // Record showing an ad
  public registerImpression(ad: Ad): void {
    this.adsShownInSession++;
    this.lastAdTimestamp = Date.now();
    this.currentActiveAd = ad;
    this.trackAdEvent(ad.id, ad.campaignId, "impression");
  }

  // Record user clicking an ad
  public registerClick(ad: Ad): void {
    this.trackAdEvent(ad.id, ad.campaignId, "click");
    if (ad.targetUrl) {
      window.open(ad.targetUrl, "_blank", "noopener,noreferrer");
    }
  }

  // Check if a vocal ad can be triggered right now
  public canTriggerVocalAd(
    sessionState: AdSessionState,
    isUserSpeaking: boolean = false,
    isGeminiSpeaking: boolean = false,
    userPlan?: SubscriptionPlan,
    force: boolean = false
  ): boolean {
    if (userPlan === "premium") return false;
    if (!this.config.enabled) return false;
    if (!force && (isUserSpeaking || isGeminiSpeaking)) return false;

    // Forbidden states check
    const forbiddenStates: AdSessionState[] = [
      "connecting",
      "analyzing",
      "testing",
      "error",
    ];
    if (forbiddenStates.includes(sessionState)) return false;

    if (!force) {
      // Check session limits & interval
      if (this.adsShownInSession >= this.config.maxAdsPerSession) return false;
      const now = Date.now();
      if (now - this.lastAdTimestamp < this.config.minIntervalBetweenAds) return false;
    }

    return true;
  }

  // Get next vocal ad offer in rotation (80k FCFA, 100k FCFA, or Combined)
  public getNextVocalAdOffer(): VocalAdOffer {
    const offerIndex = this.adsShownInSession % VOCAL_DEMO_OFFERS.length;
    return VOCAL_DEMO_OFFERS[offerIndex];
  }

  // Mark vocal ad triggered
  public markVocalAdTriggered(offerId: string): void {
    this.adsShownInSession++;
    this.lastAdTimestamp = Date.now();
    this.trackAdEvent(offerId, "VOCAL_CAMPAIGN", "impression");
  }

  // ---------------------------------------------------------------------------
  // AUDIO AD QUEUE & NATURAL PAUSE EXECUTION (NEVER INTERRUPT GEMINI SPEAKING)
  // ---------------------------------------------------------------------------

  /**
   * Registers a playback callback handler (e.g. from DiagAssistLiveScreen or AudioEngine)
   */
  public registerAudioPlaybackHandler(handler: (ad: PriorityAudioAd) => void): void {
    this.audioPlaybackHandler = handler;
  }

  /**
   * Updates Gemini's speaking status. When Gemini finishes speaking (speaking = false),
   * any pending audio ad in the priority queue is played at this natural pause.
   */
  public setGeminiSpeakingStatus(speaking: boolean): void {
    const previousState = this.isGeminiSpeaking;
    this.isGeminiSpeaking = speaking;

    // Transition from speaking to silent -> Natural pause detected in speech stream!
    if (previousState && !speaking) {
      this.processAudioAdQueue();
    }
  }

  /**
   * Alias for setGeminiSpeakingStatus to update Gemini speaking state
   */
  public setGeminiSpeaking(speaking: boolean): void {
    this.setGeminiSpeakingStatus(speaking);
  }

  /**
   * Directly notifies a natural pause in the Gemini stream
   */
  public notifyNaturalPause(): void {
    this.setGeminiSpeakingStatus(false);
  }

  /**
   * Selects a short MP3 audio ad and queues it in Gemini's playback stream.
   * Uses a priority queue that NEVER interrupts AI speech, waiting for a natural pause.
   */
  public playAudioAd(options?: {
    customAd?: Partial<PriorityAudioAd>;
    userPlan?: SubscriptionPlan;
    priority?: number;
    force?: boolean;
    onStart?: () => void;
    onEnded?: () => void;
    onError?: (err: any) => void;
  }): PriorityAudioAd | null {
    // Premium plan protection
    if (options?.userPlan === "premium") {
      console.log("[AdManager] playAudioAd bypassed for Premium user.");
      return null;
    }

    if (!this.config.enabled) {
      return null;
    }

    // Select candidate short audio ad
    const candidateIndex = this.adsShownInSession % SHORT_AUDIO_ADS_MP3.length;
    const baseAd = SHORT_AUDIO_ADS_MP3[candidateIndex] || SHORT_AUDIO_ADS_MP3[0];

    const newAudioAd: PriorityAudioAd = {
      id: options?.customAd?.id || `AUDIO-AD-${Date.now()}`,
      title: options?.customAd?.title || baseAd.title,
      mp3Url: options?.customAd?.mp3Url || baseAd.mp3Url,
      vocalScript: options?.customAd?.vocalScript || baseAd.vocalScript,
      adVoicePrompt: options?.customAd?.adVoicePrompt || baseAd.adVoicePrompt,
      priority: options?.priority ?? baseAd.priority ?? 1,
      timestamp: Date.now(),
    };

    // Push into priority queue (sorted by priority ASC: 1 = top priority)
    this.audioAdQueue.push(newAudioAd);
    this.audioAdQueue.sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp);

    console.log(`[AdManager] MP3 Audio ad queued (Priority ${newAudioAd.priority}): "${newAudioAd.title}". Queue length: ${this.audioAdQueue.length}`);

    // If Gemini is NOT speaking right now, process natural pause queue immediately
    if (!this.isGeminiSpeaking) {
      return this.processAudioAdQueue(options);
    } else {
      console.log("[AdManager] Gemini is currently speaking. Audio ad waiting in priority queue for natural pause...");
      return newAudioAd;
    }
  }

  /**
   * Processes and plays the highest priority queued audio ad if Gemini is not currently speaking.
   */
  public processAudioAdQueue(options?: {
    onStart?: () => void;
    onEnded?: () => void;
    onError?: (err: any) => void;
  }): PriorityAudioAd | null {
    if (this.isGeminiSpeaking) {
      console.log("[AdManager] Cannot play queued audio ad: Gemini is speaking.");
      return null;
    }

    if (this.audioAdQueue.length === 0) {
      return null;
    }

    const nextAd = this.audioAdQueue.shift()!;
    this.adsShownInSession++;
    this.lastAdTimestamp = Date.now();
    this.trackAdEvent(nextAd.id, "AUDIO_AD_CAMPAIGN", "impression");

    console.log(`[AdManager] Playing audio ad at natural pause: "${nextAd.title}"`);

    if (options?.onStart) {
      options.onStart();
    }

    if (this.audioPlaybackHandler) {
      try {
        this.audioPlaybackHandler(nextAd);
      } catch (err) {
        console.error("[AdManager] Error in audioPlaybackHandler:", err);
      }
    } else if (typeof window !== "undefined" && nextAd.mp3Url) {
      // Fallback HTML5 Audio playback if no custom handler is registered
      try {
        const audio = new Audio(nextAd.mp3Url);
        audio.onended = () => {
          console.log(`[AdManager] Audio ad playback finished: ${nextAd.title}`);
          if (options?.onEnded) options.onEnded();
        };
        audio.onerror = (e) => {
          console.warn("[AdManager] Audio MP3 playback failed, resorting to SpeechSynthesis:", e);
          if (nextAd.vocalScript && "speechSynthesis" in window) {
            const utterance = new SpeechSynthesisUtterance(nextAd.vocalScript);
            utterance.lang = "fr-FR";
            utterance.onend = () => { if (options?.onEnded) options.onEnded(); };
            window.speechSynthesis.speak(utterance);
          } else if (options?.onError) {
            options.onError(e);
          }
        };
        audio.play().catch((err) => {
          console.warn("[AdManager] Audio play error (autoplay restrictions):", err);
          if (nextAd.vocalScript && "speechSynthesis" in window) {
            const utterance = new SpeechSynthesisUtterance(nextAd.vocalScript);
            utterance.lang = "fr-FR";
            utterance.onend = () => { if (options?.onEnded) options.onEnded(); };
            window.speechSynthesis.speak(utterance);
          } else if (options?.onError) {
            options.onError(err);
          }
        });
      } catch (err) {
        console.error("[AdManager] Error instantiating HTML5 Audio:", err);
        if (options?.onError) options.onError(err);
      }
    }

    return nextAd;
  }

  /**
   * Returns current pending priority queue
   */
  public getAudioAdQueue(): PriorityAudioAd[] {
    return [...this.audioAdQueue];
  }

  // Record closing an ad
  public registerClose(ad: Ad): void {
    this.currentActiveAd = null;
    this.trackAdEvent(ad.id, ad.campaignId, "close");
  }

  // Internal event tracking
  private trackAdEvent(adId: string, campaignId: string, event: "impression" | "click" | "close"): void {
    const eventRecord: AdEventTrack = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      adId,
      campaignId,
      event,
      timestamp: new Date(),
      sessionId: this.sessionId,
    };
    this.events.push(eventRecord);

    try {
      localStorage.setItem("diagassist_ad_events", JSON.stringify(this.events.slice(-200)));
    } catch {
      // Ignore quota errors
    }
  }

  // Admin stats calculation
  public getStats() {
    const impressions = this.events.filter((e) => e.event === "impression").length;
    const clicks = this.events.filter((e) => e.event === "click").length;
    const closes = this.events.filter((e) => e.event === "close").length;
    const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : "0.00";

    return {
      impressions,
      clicks,
      closes,
      ctr,
      activeAdsCount: this.ads.filter((a) => a.active).length,
      activeCampaignsCount: this.campaigns.filter((c) => c.active).length,
    };
  }

  // Admin getters & setters
  public getConfig(): AdConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<AdConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getAds(): Ad[] {
    return [...this.ads];
  }

  public toggleAdActive(adId: string): void {
    this.ads = this.ads.map((a) => (a.id === adId ? { ...a, active: !a.active } : a));
  }

  public getCampaigns(): AdCampaign[] {
    return [...this.campaigns];
  }

  public getAdvertisers(): Advertiser[] {
    return [...this.advertisers];
  }

  public addAd(newAd: Ad): void {
    this.ads.unshift(newAd);
  }

  public resetSessionLimits(): void {
    this.adsShownInSession = 0;
    this.lastAdTimestamp = 0;
  }
}

// Singleton instance for global app usage
export const globalAdManager = new AdManager();

/**
 * Helper function to play an MP3 audio ad via globalAdManager
 */
export function playAudioAd(options?: Parameters<AdManager["playAudioAd"]>[0]) {
  return globalAdManager.playAudioAd(options);
}

