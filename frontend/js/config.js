/* Configuration du site. Sous Docker, ce fichier est régénéré au démarrage du conteneur nginx
   à partir des variables d'environnement API_URL et GITHUB_URL (voir nginx/default.conf.template).
   Ouvert tel quel (sans Docker), le site utilise ces valeurs par défaut. */
window.APP_CONFIG = {
  // URL de l'API vue depuis le NAVIGATEUR (pas depuis un conteneur)
  API_URL: "http://localhost:8000",
  // URL du dépôt GitHub du projet : le lien du pied de page n'apparaît que si elle est renseignée
  GITHUB_URL: "",
};
