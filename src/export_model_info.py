"""Exporte dans models/model_info.json les résultats du modèle affichés par le site (page « Modèle »).

Les chiffres viennent des sorties DÉJÀ calculées du notebook 04 (évaluation finale sur le test, importance
SHAP out-of-fold sur le train) : ce script ne relit ni ne réévalue jamais le test.

Usage (depuis la racine du projet) : python -m src.export_model_info
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTEBOOK = ROOT / "notebooks" / "04_interpretation_evaluation.ipynb"
OUT_PATH = ROOT / "models" / "model_info.json"

COST_RATIO = 10           # hypothèse de coût FN/FP retenue en phase 3 (illustrative)
BORDERLINE_MARGIN = 0.10  # « cas limites » du notebook 04 (section 2.1) : à moins de 0.10 du seuil
N_TOP_FEATURES = 8

METRIC_ROWS = {
    "AUC-PR": "average_precision",
    "AUC-ROC": "roc_auc",
    "Recall (défaut)": "recall",
    "Precision (défaut)": "precision",
}


def cell_output(cells, marker):
    """Texte des sorties de la cellule de code dont le source contient `marker`."""
    for cell in cells:
        if cell["cell_type"] == "code" and marker in "".join(cell["source"]):
            parts = []
            for out in cell.get("outputs", []):
                if out.get("output_type") == "stream":
                    parts.append("".join(out["text"]))
                elif "text/plain" in out.get("data", {}):
                    parts.append("".join(out["data"]["text/plain"]))
            return "\n".join(parts)
    raise ValueError(f"Cellule introuvable dans le notebook : {marker!r}")


def parse_test_metrics(text):
    """Lignes du type : AUC-PR   0.403 (+/- 0.004)   0.406   [0.383, 0.430]"""
    metrics = {}
    for label, key in METRIC_ROWS.items():
        m = re.search(
            rf"^{re.escape(label)}\s+([\d.]+) \(\+/- [\d.]+\)\s+([\d.]+)\s+\[([\d.]+), ([\d.]+)\]",
            text, re.MULTILINE,
        )
        assert m, f"Métrique introuvable : {label}"
        metrics[key] = {
            "value": float(m.group(2)), "ci_low": float(m.group(3)), "ci_high": float(m.group(4)),
            "cv_mean": float(m.group(1)),
        }
    return metrics


def parse_confusion(text):
    """Comptes de la matrice de confusion à partir des phrases imprimées par le notebook."""
    tp, n_defaults = map(int, re.search(r"détectés\s*:\s*(\d+) / (\d+)", text).groups())
    fp, n_good = map(int, re.search(r"refusés\s*:\s*(\d+) / (\d+)", text).groups())
    return {"tp": tp, "fn": n_defaults - tp, "fp": fp, "tn": n_good - fp}


def parse_importance(text):
    """Deux blocs : (mean_abs_shap, part_%) puis corrélation valeur/SHAP (sens de l'effet)."""
    shares = re.findall(r"^(\S+)\s+([\d.]+)\s+([\d.]+)\s*\\?\s*$", text, re.MULTILINE)
    corr = dict(re.findall(r"^(\S+)\s+(-?[\d.]+)\s*$", text, re.MULTILINE))
    items = []
    for feature, mean_abs, share in shares[:N_TOP_FEATURES]:
        c = float(corr[feature])
        # Corrélation faible = effet non monotone (ex. nombre de prêts immobiliers)
        effect = "increases" if c > 0.2 else "decreases" if c < -0.2 else "mixed"
        items.append({
            "feature": feature, "mean_abs_shap": float(mean_abs), "share_pct": float(share), "effect": effect,
        })
    return items


if __name__ == "__main__":
    cells = json.loads(NOTEBOOK.read_text(encoding="utf-8"))["cells"]
    config = json.loads((ROOT / "models" / "threshold_config.json").read_text(encoding="utf-8"))

    metrics = parse_test_metrics(cell_output(cells, "comparison = pd.DataFrame(rows)"))
    confusion = parse_confusion(cell_output(cells, "confusion_matrix(y_test"))
    importance = parse_importance(cell_output(cells, "importance_table.head(10)"))

    n_clients = sum(confusion.values())
    info = {
        "model": config["model"],
        "threshold": config["threshold"],
        "cost_ratio_assumption": COST_RATIO,
        "borderline_margin": BORDERLINE_MARGIN,
        "test": {
            "n_clients": n_clients,
            "n_defaults": confusion["tp"] + confusion["fn"],
            "default_rate": round((confusion["tp"] + confusion["fn"]) / n_clients, 4),
            "metrics": metrics,
            "confusion": confusion,
        },
        "global_importance": importance,
        "source": "notebooks/04_interpretation_evaluation.ipynb (sections 1.1 et 3.3) ; test évalué une seule fois",
    }
    OUT_PATH.write_text(json.dumps(info, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Écrit : {OUT_PATH}")
    print(json.dumps(info, indent=2, ensure_ascii=False))
