"""API de scoring : reçoit les caractéristiques brutes d'un client, renvoie sa probabilité de défaut.

Le pipeline est EXACTEMENT celui de l'entraînement : `src.preprocessing.apply_cleaning`
(sentinelles 96/98, imputation, capping, variables dérivées, standardisation), avec les
paramètres appris sur le train et sauvegardés dans models/.

Lancement local (depuis la racine du projet) : uvicorn app.main:app --reload
Documentation Swagger : http://localhost:8000/docs
"""
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from src.preprocessing import apply_cleaning

MODELS_DIR = Path(os.environ.get("MODELS_DIR", Path(__file__).resolve().parent.parent / "models"))
N_TOP_FACTORS = 5

# Artefacts chargés une seule fois au démarrage (modèle, scaler, paramètres de nettoyage, seuil)
state = {}


def load_artifacts():
    """Charge tous les fichiers produits pendant l'entraînement."""
    config = json.loads((MODELS_DIR / "threshold_config.json").read_text(encoding="utf-8"))
    feature_info = joblib.load(MODELS_DIR / "feature_list.joblib")
    # Résultats du test pour /model-info : optionnel, l'API de scoring fonctionne sans
    info_path = MODELS_DIR / "model_info.json"
    model_info = json.loads(info_path.read_text(encoding="utf-8")) if info_path.exists() else None
    return {
        "model_info": model_info,
        "model": joblib.load(MODELS_DIR / "final_model.joblib"),
        "scaler": joblib.load(MODELS_DIR / "scaler.joblib"),
        "cleaning_params": json.loads((MODELS_DIR / "cleaning_params.json").read_text(encoding="utf-8")),
        "feature_names": feature_info["feature_names"],
        "continuous_cols": feature_info["continuous_cols"],
        "threshold": config["threshold"],
        "model_name": config["model"],
    }


@asynccontextmanager
async def lifespan(app):
    # Si le chargement échoue, l'API démarre quand même et le signale via /health (503)
    try:
        state.update(load_artifacts())
    except Exception as exc:
        state["error"] = f"{type(exc).__name__}: {exc}"
    yield


app = FastAPI(
    title="Credit Scoring API",
    description=(
        "Prédit la probabilité de défaut grave (90 jours de retard ou plus) d'un client dans les "
        "2 ans. Projet portfolio : le seuil de décision repose sur une hypothèse de coût (k=10), "
        "ce n'est pas un outil de décision réel."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS : origines autorisées à appeler l'API depuis un navigateur (le frontend statique).
# Variable ALLOWED_ORIGINS (URLs séparées par des virgules, sans slash final), lue au démarrage.
# Doit inclure à la fois le frontend de développement et le frontend déployé, par exemple :
#   ALLOWED_ORIGINS=http://localhost:3000,https://<utilisateur>.github.io
# Défaut "*" ci-dessous = pratique en développement local, mais PEU SÛR en production (n'importe
# quel site pourrait appeler l'API) — à restreindre explicitement dès que l'URL du frontend déployé
# est connue (docker-compose.yml et render.yaml le font déjà pour leurs environnements respectifs).
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# ---------- Schémas d'entrée / sortie ----------

class ClientFeatures(BaseModel):
    """Caractéristiques brutes d'un client : les colonnes originales du dataset (sans id ni cible)."""

    # extra="forbid" : un nom de champ mal orthographié est signalé au lieu d'être ignoré en silence
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "RevolvingUtilizationOfUnsecuredLines": 0.30,
                "age": 45,
                "NumberOfTime30-59DaysPastDueNotWorse": 0,
                "DebtRatio": 0.35,
                "MonthlyIncome": 5400,
                "NumberOfOpenCreditLinesAndLoans": 8,
                "NumberOfTimes90DaysLate": 0,
                "NumberRealEstateLoansOrLines": 1,
                "NumberOfTime60-89DaysPastDueNotWorse": 0,
                "NumberOfDependents": 0,
            }
        },
    )

    revolving_utilization: float = Field(
        alias="RevolvingUtilizationOfUnsecuredLines", ge=0, allow_inf_nan=False,
        description="Taux d'utilisation des lignes de crédit renouvelables (0.30 = 30 %). "
                    "Les valeurs extrêmes sont plafonnées par le pipeline.",
    )
    age: int = Field(
        ge=18, le=120, description="Âge en années (18 ans minimum : majorité pour contracter un crédit).",
    )
    past_due_30_59: int = Field(
        alias="NumberOfTime30-59DaysPastDueNotWorse", ge=0, le=98,
        description="Nombre de retards de 30 à 59 jours. 96 et 98 sont des codes d'erreur du dataset "
                    "source, traités comme valeurs manquantes.",
    )
    debt_ratio: float = Field(
        alias="DebtRatio", ge=0, allow_inf_nan=False,
        description="Ratio d'endettement (dettes mensuelles / revenu mensuel).",
    )
    monthly_income: float | None = Field(
        default=None, alias="MonthlyIncome", ge=0, allow_inf_nan=False,
        description="Revenu mensuel. Optionnel : si absent, imputé par la médiane du train.",
    )
    open_credit_lines: int = Field(
        alias="NumberOfOpenCreditLinesAndLoans", ge=0,
        description="Nombre de crédits et lignes de crédit ouverts.",
    )
    times_90_days_late: int = Field(
        alias="NumberOfTimes90DaysLate", ge=0, le=98,
        description="Nombre de retards de 90 jours ou plus (96 et 98 : codes d'erreur).",
    )
    real_estate_loans: int = Field(
        alias="NumberRealEstateLoansOrLines", ge=0, description="Nombre de prêts immobiliers.",
    )
    past_due_60_89: int = Field(
        alias="NumberOfTime60-89DaysPastDueNotWorse", ge=0, le=98,
        description="Nombre de retards de 60 à 89 jours (96 et 98 : codes d'erreur).",
    )
    dependents: int | None = Field(
        default=None, alias="NumberOfDependents", ge=0, le=20,
        description="Nombre de personnes à charge. Optionnel : si absent, imputé par le mode du train.",
    )


class Factor(BaseModel):
    feature: str = Field(description="Variable du modèle (après feature engineering).")
    value: float = Field(description="Valeur pour ce client, en unités d'origine (après nettoyage).")
    shap_value: float = Field(
        description="Contribution SHAP en log-odds : > 0 pousse vers le défaut, < 0 vers l'acceptation."
    )


class Prediction(BaseModel):
    default_probability: float = Field(description="Probabilité de défaut estimée par le modèle.")
    decision: Literal["accepté", "refusé"]
    threshold: float = Field(description="Seuil de décision : refusé si probabilité >= seuil.")
    top_factors: list[Factor] | None = Field(
        default=None, description="Facteurs les plus influents pour CE client (si explain=true)."
    )


# ---------- Gestion des erreurs de validation ----------

def french_message(err):
    """Traduit les erreurs de validation courantes en messages clairs (repli : message pydantic)."""
    kind, ctx = err["type"], err.get("ctx", {})
    if kind == "missing":
        return "champ obligatoire manquant"
    if kind == "extra_forbidden":
        return "champ inconnu (voir /docs pour la liste des champs acceptés)"
    if kind == "greater_than_equal":
        return f"doit être supérieur ou égal à {ctx['ge']}"
    if kind == "less_than_equal":
        return f"doit être inférieur ou égal à {ctx['le']}"
    if kind in ("int_parsing", "int_from_float", "float_parsing", "finite_number"):
        return "doit être un nombre valide (entier pour les compteurs)"
    if kind == "json_invalid":
        return "le corps de la requête n'est pas un JSON valide"
    if kind == "model_attributes_type":
        return "le corps de la requête doit être un objet JSON (clés = noms des colonnes)"
    return err["msg"]


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    details = []
    for err in exc.errors():
        # Erreur portant sur tout le corps de la requête (JSON illisible, mauvais type) : pas de champ précis
        body_level = err["type"] in ("json_invalid", "model_attributes_type")
        item = {
            "field": "body" if body_level else ".".join(str(p) for p in err["loc"][1:]) or "body",
            "message": french_message(err),
        }
        if err["type"] != "missing" and not body_level:
            item["received_value"] = err.get("input")
        details.append(item)
    return JSONResponse(status_code=422, content={"error": "Données d'entrée invalides", "details": details})


# ---------- Endpoints ----------

def require_model():
    if "error" in state or "model" not in state:
        raise HTTPException(status_code=503, detail=f"Modèle non chargé : {state.get('error', 'inconnu')}")


@app.get("/health", summary="Vérifie que l'API tourne et que le modèle est chargé")
def health():
    require_model()
    return {
        "status": "ok",
        "model_loaded": True,
        "model": state["model_name"],
        "threshold": state["threshold"],
    }


@app.get("/model-info", summary="Performances du modèle sur le test et importance globale des variables")
def model_info():
    # Chiffres extraits du notebook 04 (test évalué une seule fois) : voir src/export_model_info.py
    if state.get("model_info") is None:
        raise HTTPException(
            status_code=404,
            detail="models/model_info.json absent : générez-le avec `python -m src.export_model_info`.",
        )
    return state["model_info"]


@app.post("/predict", response_model=Prediction, summary="Évalue un client")
def predict(
    client: ClientFeatures,
    explain: bool = Query(False, description="Ajoute les facteurs (SHAP local) les plus influents."),
):
    require_model()

    # Une ligne brute avec les noms de colonnes d'origine, exactement comme dans le dataset
    raw = pd.DataFrame([client.model_dump(by_alias=True)]).astype(float)

    # Même pipeline que l'entraînement (src/preprocessing.py) + scaler déjà ajusté sur le train
    X = apply_cleaning(
        raw, state["cleaning_params"], state["scaler"], state["feature_names"], state["continuous_cols"]
    )

    proba = float(state["model"].predict_proba(X)[0, 1])
    decision = "refusé" if proba >= state["threshold"] else "accepté"

    top_factors = None
    if explain:
        # TreeSHAP natif de LightGBM : une contribution par variable + la valeur de base en dernier
        shap_values = state["model"].predict(X, pred_contrib=True)[0][:-1]

        # Valeurs en unités d'origine pour que les facteurs soient lisibles
        X_display = X.copy()
        X_display[state["continuous_cols"]] = state["scaler"].inverse_transform(X[state["continuous_cols"]])

        top_idx = np.argsort(-np.abs(shap_values))[:N_TOP_FACTORS]
        top_factors = [
            Factor(
                feature=state["feature_names"][i],
                value=round(float(X_display.iloc[0, i]), 4),
                shap_value=round(float(shap_values[i]), 4),
            )
            for i in top_idx
        ]

    return Prediction(
        default_probability=round(proba, 4),
        decision=decision,
        threshold=state["threshold"],
        top_factors=top_factors,
    )


if __name__ == "__main__":
    # Point d'entrée alternatif pour un hébergeur qui lance `python app/main.py` plutôt que la
    # commande uvicorn du Dockerfile. PORT est imposé par la plateforme (ex. Render) ; 8000 en local.
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
