/* Configuration du site.
   - Sous Docker, ce fichier est IGNORÉ : nginx intercepte la requête /js/config.js et répond avec
     un contenu généré à partir des variables d'environnement API_URL et GITHUB_URL (voir
     nginx/default.conf.template) — rien à changer ici pour ce mode.
   - Sur GitHub Pages (site 100 % statique, pas de serveur pour générer quoi que ce soit), c'est ce
     fichier tel quel qui est servi : c'est ici qu'il faut mettre à jour l'URL de l'API une fois
     déployée sur Render. Une seule ligne à changer : API_BASE_URL ci-dessous. */

// URL de l'API vue depuis le NAVIGATEUR (pas depuis un conteneur), sans slash final.
// À REMPLACER par l'URL Render une fois l'API déployée, ex. "https://credit-scoring-api.onrender.com"
const API_BASE_URL = "http://localhost:8000";

window.APP_CONFIG = {
  API_URL: API_BASE_URL,
  // URL du dépôt GitHub du projet : le lien du pied de page n'apparaît que si elle est renseignée
  GITHUB_URL: "",
};
