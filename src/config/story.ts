/**
 * Histoire du chapitre 1 — « Le signal impossible ». Dialogues complets, courts (2 à 4 répliques par séquence).
 * Chaque séquence est montrée automatiquement UNE fois (passable), puis consultable dans le journal des transmissions ;
 * rejouer une mission ne la répète pas. Les identifiants sont enregistrés dans la sauvegarde : ne jamais les changer.
 */
export type Speaker = 'nova' | 'signal' | 'defense' | 'system';

export const SPEAKERS: Record<Speaker, string> = {
  nova: 'NOVA',
  signal: 'SIGNAL',
  defense: 'DÉFENSES',
  system: 'SYSTÈME',
};

export interface StoryLine {
  who: Speaker;
  text: string;
}

export interface StorySequence {
  id: string;
  /** Titre dans le journal. */
  title: string;
  lines: StoryLine[];
  /** Dernière séquence du chapitre : affiche « Fin du chapitre — la suite : À venir ». */
  chapterEnd?: boolean;
}

export const STORY: StorySequence[] = [
  {
    id: 'm1-before',
    title: 'Redémarrage',
    lines: [
      { who: 'nova', text: 'Systèmes en cours de redémarrage… Pilote, vous m’entendez ?' },
      { who: 'nova', text: 'Une anomalie nous retient sur cette orbite. Vos propulseurs n’obéissent plus qu’à une commande : l’inversion.' },
      { who: 'nova', text: 'Évitons les débris. Le temps que je comprenne où nous sommes.' },
    ],
  },
  {
    id: 'm1-after',
    title: 'Un signal',
    lines: [
      { who: 'nova', text: 'Orbite stable. Pilote… je capte une transmission.' },
      { who: 'signal', text: '…liaison… maintenez… la liaison…' },
      { who: 'nova', text: 'La source se nomme Écho-7. Cette station a été déclarée détruite il y a vingt ans.' },
    ],
  },
  {
    id: 'm2-after',
    title: 'Le relais',
    lines: [
      { who: 'signal', text: 'Ne coupez pas la transmission.' },
      { who: 'nova', text: 'Le relais est en ligne. Le signal répond à nos balises, comme s’il les attendait.' },
    ],
  },
  {
    id: 'm3-before',
    title: 'Coordonnées effacées',
    lines: [
      { who: 'nova', text: 'Des fragments de coordonnées s’affichent un à un, puis s’effacent.' },
      { who: 'nova', text: 'Attrapez-les avant qu’ils disparaissent. Un fragment manqué reviendra.' },
    ],
  },
  {
    id: 'm3-after',
    title: 'Les coordonnées',
    lines: [
      { who: 'nova', text: 'Les coordonnées sont reconstituées.' },
      { who: 'nova', text: 'Elles désignent Écho-7. Exactement là où la station est censée avoir disparu.' },
    ],
  },
  {
    id: 'm4-after',
    title: 'Archives de destruction',
    lines: [
      { who: 'nova', text: 'D’après mes archives, Écho-7 a été détruite. Aucun survivant, aucun signal.' },
      { who: 'signal', text: '…pourtant, vous m’entendez.' },
      { who: 'nova', text: 'Quelque chose ne colle pas, pilote.' },
    ],
  },
  {
    id: 'm5-before',
    title: 'La boîte noire',
    lines: [
      { who: 'nova', text: 'Terminez deux cycles de balises : le relais devrait libérer sa boîte noire.' },
    ],
  },
  {
    id: 'm5-after',
    title: 'Projet « Polarity »',
    lines: [
      { who: 'nova', text: 'Boîte noire récupérée. L’enregistrement mentionne un projet : « Polarity ».' },
      { who: 'nova', text: 'Ce nom figure aussi dans mes propres registres. Je ne sais pas pourquoi.' },
    ],
  },
  {
    id: 'm6-after',
    title: 'Une signature',
    lines: [
      { who: 'signal', text: 'Cette signature… je la reconnais.' },
      { who: 'nova', text: 'Elle parle de notre vaisseau, pilote. Comme si elle l’attendait depuis longtemps.' },
    ],
  },
  {
    id: 'm7-after',
    title: 'Un souvenir',
    lines: [
      { who: 'nova', text: 'Un souvenir… des couloirs blancs, une lumière violette. J’étais déjà là.' },
      { who: 'nova', text: 'C’est impossible. Et pourtant, je connais ces couloirs.' },
    ],
  },
  {
    id: 'm8-before',
    title: 'Verrous et défenses',
    lines: [
      { who: 'nova', text: 'Trois verrous protègent la station. Chacun cède après un cycle complet.' },
      { who: 'nova', text: 'Je détecte un laser balayeur : un faisceau mobile. Restez hors de sa trajectoire.' },
    ],
  },
  {
    id: 'm8-after',
    title: 'Menace identifiée',
    lines: [
      { who: 'defense', text: 'Intrus identifié. Menace confirmée.' },
      { who: 'nova', text: 'Les défenses d’Écho-7 nous prennent pour un ennemi. Pourquoi ?' },
    ],
  },
  {
    id: 'm9-after',
    title: 'Un accès secondaire',
    lines: [
      { who: 'signal', text: 'Pas par là… Il existe un accès secondaire.' },
      { who: 'nova', text: 'Cette voix cherche à nous guider. Je la suis, pilote.' },
    ],
  },
  {
    id: 'm10-before',
    title: 'Le sas',
    lines: [
      { who: 'nova', text: 'Le sas est verrouillé trois fois. Un verrou par phase : astéroïdes, électricité, puis tout à la fois.' },
      { who: 'nova', text: 'On y est presque.' },
    ],
  },
  {
    id: 'm10-after',
    title: 'Écho-7',
    chapterEnd: true,
    lines: [
      { who: 'system', text: 'Sas ouvert. Écho-7 : aucun signe vital détecté. Station vide.' },
      { who: 'nova', text: 'Rien. Pas un mouvement.' },
      { who: 'signal', text: 'NOVA… tu es revenue.' },
    ],
  },
];

export function storyById(id: string): StorySequence | undefined {
  return STORY.find((s) => s.id === id);
}
