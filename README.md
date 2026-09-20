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

_À compléter après la phase de modélisation._

## Limites

_À compléter._

## Prochaines étapes

- Feature engineering (traitement des valeurs manquantes, des valeurs aberrantes identifiées en
  EDA, éventuelles transformations/discrétisations).
- Modélisation : régression logistique (baseline), puis modèles d'arbres (XGBoost, LightGBM).
- Gestion du déséquilibre de classes (pondération, rééchantillonnage) si nécessaire.
- Interprétabilité du modèle final avec SHAP.
- Choix d'un seuil de décision aligné sur le coût métier des erreurs.

## Structure du projet

```
credit-scoring/
├── data/raw/            # Données brutes (jamais modifiées)
├── data/processed/      # Splits train/test générés par l'EDA
├── notebooks/           # Notebooks Jupyter
├── src/                 # Code source réutilisable
├── models/              # Modèles entraînés (non versionnés)
├── requirements.txt
└── README.md
```

## Installation

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
