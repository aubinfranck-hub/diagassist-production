// Préférences utilisateur (nom de l'assistant, voix) stockées dans le localStorage.
// L'événement « storage » du navigateur ne se déclenche QUE pour les autres onglets : pour que les composants du même
// onglet soient prévenus, on émet notre propre événement au moment de l'écriture. Cela remplace une boucle qui relisait
// le localStorage toutes les secondes (réveil du processeur permanent, donc batterie, sur smartphone).
export const PREFS_EVENT = "diagassist-prefs-changed";

export function setPref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
  window.dispatchEvent(new Event(PREFS_EVENT));
}
