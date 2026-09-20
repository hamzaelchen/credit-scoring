"""Exporte dans models/cleaning_params.json les paramètres de nettoyage appris sur le train.

L'API n'a pas accès aux données (data/ n'est pas dans l'image Docker) : elle relit ces valeurs
(médianes, mode, seuils de capping) au lieu de les recalculer. Elles sont calculées par
`fit_cleaning_params`, la même fonction que celle validée en phase 4 contre X_train_processed.csv.

Usage (depuis la racine du projet) : python -m src.export_cleaning_params
"""
import json
from pathlib import Path

import pandas as pd

from src.preprocessing import fit_cleaning_params

ROOT = Path(__file__).resolve().parent.parent


def to_native(value):
    """Convertit les types numpy en types Python (sérialisation JSON, sans perte de précision)."""
    if isinstance(value, dict):
        return {k: to_native(v) for k, v in value.items()}
    return float(value)


if __name__ == "__main__":
    train_raw = pd.read_csv(ROOT / "data" / "processed" / "train.csv", index_col="id")
    params = to_native(fit_cleaning_params(train_raw))

    out_path = ROOT / "models" / "cleaning_params.json"
    out_path.write_text(json.dumps(params, indent=2), encoding="utf-8")
    print(f"Paramètres écrits dans {out_path}")
    print(json.dumps(params, indent=2))
