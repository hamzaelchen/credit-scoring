# Credit Scoring — Prédiction de défaut de crédit

Projet portfolio (préparation entretiens stage PFE data science) : prédire la probabilité qu'un
client soit en défaut de paiement grave dans les 2 ans, à partir du dataset Kaggle
["Give Me Some Credit"](https://www.kaggle.com/c/GiveMeSomeCredit).

## Contexte et problème business

Une banque doit décider d'accorder ou non un crédit à un client. Elle veut estimer, au moment de
la demande, la probabilité que ce client connaisse un défaut de paiement grave (retard de 90 jours
ou plus) dans les 2 années suivantes. C'est un problème de **classification binaire** sur données
tabulaires, avec une forte **contrainte métier** : le coût d'une mauvaise décision n'est pas
symétrique (voir section Coût des erreurs).

La cible `SeriousDlqin2yrs` vaut 1 si le client a fait défaut, 0 sinon.

## Données

- Source : Kaggle, compétition [GiveMeSomeCredit](https://www.kaggle.com/c/GiveMeSomeCredit).
- Fichier : `cs-training.csv`, ~150 000 lignes, 1 identifiant + 10 variables explicatives + 1 cible.
- Cible : `SeriousDlqin2yrs` — déséquilibrée, environ 7 % de défauts.
- Variables : âge, revenu mensuel, ratio d'endettement (`DebtRatio`), taux d'utilisation des lignes
  de crédit renouvelables (`RevolvingUtilizationOfUnsecuredLines`), nombre de crédits/prêts
  ouverts, nombre de personnes à charge, et plusieurs compteurs de retards de paiement passés
  (30-59, 60-89, 90+ jours).
- `data/raw/` contient les données brutes, **jamais modifiées**. `data/processed/` contient les
  splits train/test générés par le notebook d'EDA.

## Métriques

- **AUC-PR (Precision-Recall) — métrique principale.** Avec ~7 % de défauts, la classe positive
  est rare : l'AUC-PR est beaucoup plus informative que l'AUC-ROC sur ce type de déséquilibre,
  car elle se concentre sur la capacité du modèle à bien classer la classe minoritaire (celle qui
  nous intéresse métier) sans être "gonflée" par la grande quantité de vrais négatifs faciles.
- **Recall sur la classe défaut** : proportion de mauvais payeurs correctement identifiés. Métier,
  rater un mauvais payeur (faux négatif) coûte cher — c'est un indicateur direct de ce risque.
- **AUC-ROC** : rapportée en complément, pour comparaison avec la littérature/les baselines
  Kaggle, mais à interpréter avec prudence ici (voir ci-dessous).

**Pourquoi l'accuracy est trompeuse** : un modèle qui prédit toujours "pas de défaut" obtient déjà
~93 % d'accuracy (classe majoritaire), sans aucune valeur prédictive. L'accuracy ne dit rien sur
la capacité à détecter les 7 % de clients à risque, qui sont précisément ceux qu'on cherche à
identifier.

## Baselines

1. **Classe majoritaire** : prédire systématiquement "pas de défaut". Sert de plancher — tout
   modèle doit faire mieux que cette baseline sur l'AUC-PR et le recall (l'accuracy de cette
   baseline sera trivialement élevée, ce qui illustre justement pourquoi elle n'est pas une bonne
   métrique).
2. **Régression logistique simple** : modèle linéaire interprétable, avec peu de feature
   engineering. Sert de référence "modèle simple mais raisonnable" avant d'essayer des modèles
   plus complexes (arbres, gradient boosting).

## Coût des erreurs

Les deux types d'erreurs n'ont pas le même coût pour la banque :

- **Faux négatif** (accorder un crédit à un client qui va faire défaut) : perte potentielle du
  capital prêté + intérêts non perçus. Coût élevé.
- **Faux positif** (refuser un crédit à un bon payeur) : manque à gagner sur les intérêts qu'aurait
  rapportés ce client, et coût d'opportunité/réputation. Coût plus faible que le faux négatif.

Cette asymétrie justifie de privilégier le **recall sur la classe défaut** plutôt que l'accuracy,
et guidera plus tard le choix du seuil de décision (pas nécessairement 0.5) une fois un modèle
entraîné.
## Résultats

Modèle final : LightGBM (tuné sur AUC-PR en CV 5 folds), seuil de décision = 0.57.

| Métrique | CV (5 folds) | Test (unique) |
|---|---|---|
| AUC-PR | 0.403 ± 0.004 | 0.406 [IC95% 0.383–0.430] |
| AUC-ROC | 0.864 | 0.869 |
| Recall (défauts) | 0.702 | 0.711 |
| Precision (défauts) | 0.261 | 0.258 |

Traduction métier sur le test : 71 % des mauvais payeurs sont détectés, au prix de refuser 14,6 % des bons clients (18,4 % de refus au total). Les métriques CV et test sont cohérentes — pas de signe d'overfitting.

Variables les plus influentes (SHAP) : taux d'utilisation du crédit renouvelable (30 %), total des retards passés — variable créée en feature engineering (22 %), âge (10 %), taux d'endettement (6,5 %), nombre de lignes de crédit ouvertes (4,6 %).

## Limites

- **Seuil de décision hypothétique** : calibré sur un rapport de coût k=10 illustratif (coût d'un mauvais payeur accepté = 10x coût d'un bon client refusé), à remplacer par de vraies données de coût métier en production.
- **Plafond de performance structurel** : environ 21 % des mauvais payeurs non détectés ont un profil statistiquement indiscernable des bons clients avec les variables disponibles — suggère un besoin de données externes (bureau de crédit, historique bancaire complet) plutôt qu'un problème de modèle.
- **Pas de validation temporelle** : le split train/test est aléatoire, pas chronologique — en production, il faudrait valider sur des données postérieures pour détecter un éventuel drift.
- **Signal contre-intuitif non exploré** : l'absence de revenu déclaré (`income_was_missing`) est associée à un risque plus faible, à l'inverse de l'hypothèse initiale — mériterait une investigation métier plus poussée.


## Prochaines étapes

- Feature engineering (traitement des valeurs manquantes, des valeurs aberrantes identifiées en
  EDA, éventuelles transformations/discrétisations).
- Modélisation : régression logistique (baseline), puis modèles d'arbres (XGBoost, LightGBM).
- Gestion du déséquilibre de classes (pondération, rééchantillonnage) si nécessaire.
- Interprétabilité du modèle final avec SHAP.
- Choix d'un seuil de décision aligné sur le coût métier des erreurs.

## Utilisation

Le modèle final est exposé par une API (FastAPI) et un dashboard (Streamlit), lancés ensemble avec Docker.

### Lancer avec Docker

```bash
docker compose up --build
```

| Service | URL | Rôle |
|---|---|---|
| API | http://localhost:8000 | `POST /predict`, `GET /health` |
| Documentation Swagger | http://localhost:8000/docs | Tester l'API depuis le navigateur |
| Dashboard | http://localhost:8501 | Formulaire client, décision et facteurs d'influence |

Le dashboard n'importe pas le modèle : il appelle l'API à l'adresse donnée par la variable
d'environnement `API_URL` (`http://api:8000` dans `docker-compose.yml`). Il ne démarre qu'une fois
l'API prête (`/health` renvoie 503 tant que le modèle n'est pas chargé). Arrêt : `docker compose down`.

### Exemple de requête

L'API attend les colonnes **originales** du dataset (sans `id` ni la cible). `MonthlyIncome` et
`NumberOfDependents` sont optionnels (imputés comme à l'entraînement s'ils sont absents).
Avec `?explain=true`, la réponse contient les 5 facteurs les plus influents pour ce client (SHAP local).

```bash
curl -X POST "http://localhost:8000/predict?explain=true" \
  -H "Content-Type: application/json" \
  -d '{
    "RevolvingUtilizationOfUnsecuredLines": 0.30,
    "age": 45,
    "NumberOfTime30-59DaysPastDueNotWorse": 0,
    "DebtRatio": 0.35,
    "MonthlyIncome": 5400,
    "NumberOfOpenCreditLinesAndLoans": 8,
    "NumberOfTimes90DaysLate": 0,
    "NumberRealEstateLoansOrLines": 1,
    "NumberOfTime60-89DaysPastDueNotWorse": 0,
    "NumberOfDependents": 0
  }'
```

Réponse (`shap_value` en log-odds : positif = pousse vers le refus, négatif = vers l'acceptation) :

```json
{
  "default_probability": 0.2299,
  "decision": "accepté",
  "threshold": 0.57,
  "top_factors": [
    {"feature": "total_delinquency", "value": 0.0, "shap_value": -0.3075},
    {"feature": "RevolvingUtilizationOfUnsecuredLines", "value": 0.3, "shap_value": 0.2395},
    {"feature": "age", "value": 45.0, "shap_value": 0.2087},
    {"feature": "NumberRealEstateLoansOrLines", "value": 1.0, "shap_value": -0.1108},
    {"feature": "NumberOfOpenCreditLinesAndLoans", "value": 8.0, "shap_value": -0.0942}
  ]
}
```

Sous PowerShell, utiliser `curl.exe` (et non l'alias `curl`) avec le JSON dans un fichier : `-d "@client.json"`.

Les entrées invalides renvoient un code 422 avec un message par champ, par exemple pour un âge de -5 :
`{"error": "Données d'entrée invalides", "details": [{"field": "age", "message": "doit être supérieur ou égal à 18", "received_value": -5}]}`.

### Sans Docker (développement)

```bash
pip install -r requirements-api.txt -r requirements-dashboard.txt
uvicorn app.main:app --reload                      # API sur http://localhost:8000
API_URL=http://localhost:8000 streamlit run app/dashboard.py
```

L'API rejoue exactement le pipeline d'entraînement (`src/preprocessing.py`) avec les paramètres appris
sur le train (`models/cleaning_params.json`, régénérable avec `python -m src.export_cleaning_params`).
Les images Docker utilisent `requirements-api.txt` et `requirements-dashboard.txt` (dépendances minimales
aux versions de l'entraînement) ; `requirements.txt` décrit l'environnement de développement complet.

## Structure du projet

```
credit-scoring/
├── data/raw/            # Données brutes (jamais modifiées)
├── data/processed/      # Splits train/test générés par l'EDA
├── notebooks/           # Notebooks Jupyter (EDA, baseline, modélisation, interprétation)
├── src/                 # Pipeline de preprocessing réutilisable
├── app/                 # API FastAPI (main.py) et dashboard Streamlit (dashboard.py)
├── models/              # Modèle final, scaler, seuil et paramètres de nettoyage
├── Dockerfile.api / Dockerfile.dashboard / docker-compose.yml
├── requirements.txt     # Environnement de développement complet
├── requirements-api.txt / requirements-dashboard.txt
└── README.md
```

## Installation

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
