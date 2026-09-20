"""Dashboard Streamlit : saisie d'un client -> appel de l'API /predict -> décision et explication.

Le dashboard ne charge JAMAIS le modèle : il n'appelle que l'API HTTP (URL dans la variable
d'environnement API_URL, définie par docker-compose).

Lancement local : streamlit run app/dashboard.py   (l'API doit tourner sur API_URL)
"""
import os

import matplotlib.pyplot as plt
import requests
import streamlit as st
from matplotlib.patches import Patch

API_URL = os.environ.get("API_URL", "http://localhost:8000")

# Couleurs (palette catégorielle validée) ; la décision est toujours aussi écrite en toutes lettres
GREEN, RED, BLUE = "#008300", "#e34948", "#2a78d6"

FEATURE_LABELS = {
    "RevolvingUtilizationOfUnsecuredLines": "Utilisation du crédit renouvelable",
    "age": "Âge",
    "DebtRatio": "Taux d'endettement",
    "MonthlyIncome": "Revenu mensuel",
    "NumberOfOpenCreditLinesAndLoans": "Crédits ouverts",
    "NumberOfTime30-59DaysPastDueNotWorse": "Retards de 30-59 jours",
    "NumberOfTimes90DaysLate": "Retards de 90 jours et plus",
    "NumberRealEstateLoansOrLines": "Prêts immobiliers",
    "NumberOfTime60-89DaysPastDueNotWorse": "Retards de 60-89 jours",
    "NumberOfDependents": "Personnes à charge",
    "total_delinquency": "Total des retards de paiement",
    "income_per_dependent": "Revenu par personne du foyer",
    "total_credit_lines": "Total des lignes de crédit",
    "has_sentinel_delinquency": "Code d'erreur dans les retards (96/98)",
    "income_was_missing": "Revenu non renseigné",
    "dependents_was_missing": "Personnes à charge non renseignées",
    "debtratio_extreme": "Taux d'endettement extrême",
    "revolving_extreme": "Utilisation du crédit extrême",
    "has_real_estate_loan": "Possède un prêt immobilier",
    "age_group_30-40": "Tranche d'âge 30-40 ans",
    "age_group_40-50": "Tranche d'âge 40-50 ans",
    "age_group_50-60": "Tranche d'âge 50-60 ans",
    "age_group_60+": "Tranche d'âge 60 ans et plus",
}
BINARY_FEATURES = {
    "has_sentinel_delinquency", "income_was_missing", "dependents_was_missing", "debtratio_extreme",
    "revolving_extreme", "has_real_estate_loan",
} | {f for f in FEATURE_LABELS if f.startswith("age_group_")}


def format_value(feature, value):
    """Valeur lisible : oui/non pour les indicateurs, entier ou 2 décimales sinon."""
    if feature in BINARY_FEATURES:
        return "oui" if value >= 0.5 else "non"
    if abs(value - round(value)) < 1e-9:
        return f"{value:,.0f}".replace(",", " ")
    return f"{value:.2f}"


def gauge_figure(probability, threshold, refused):
    """Barre horizontale 0-100 % : probabilité de défaut et position du seuil de décision."""
    color = RED if refused else GREEN
    fig, ax = plt.subplots(figsize=(6, 1.3))
    ax.barh(0, 1, color="#e6e6e6", height=0.5)
    ax.barh(0, probability, color=color, height=0.5)
    # La ligne du seuil s'arrête sous son étiquette pour ne pas la traverser
    ax.vlines(threshold, -0.32, 0.32, color="#222222", lw=2)
    ax.text(threshold, 0.38, f"seuil {threshold:.2f}", ha="center", va="bottom", fontsize=9)
    ax.text(min(probability, 0.97), 0, f"{probability:.1%}", ha="right" if probability > 0.15 else "left",
            va="center", fontsize=11, fontweight="bold", color="white" if probability > 0.15 else "#222222")
    ax.set_xlim(0, 1)
    ax.set_ylim(-0.4, 0.7)
    ax.set_yticks([])
    ax.set_xticks([0, 0.25, 0.5, 0.75, 1])
    ax.set_xticklabels(["0 %", "25 %", "50 %", "75 %", "100 %"], fontsize=8)
    ax.grid(False)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    fig.patch.set_facecolor("white")
    fig.tight_layout()
    return fig


def factors_figure(factors):
    """Barres horizontales des facteurs (SHAP local) : rouge = augmente le risque, bleu = le réduit."""
    ordered = sorted(factors, key=lambda f: abs(f["shap_value"]), reverse=True)
    labels = [f"{FEATURE_LABELS.get(f['feature'], f['feature'])} = {format_value(f['feature'], f['value'])}"
              for f in ordered]
    values = [f["shap_value"] for f in ordered]

    fig, ax = plt.subplots(figsize=(7, 0.6 * len(ordered) + 1.2))
    bars = ax.barh(range(len(ordered)), values, color=[RED if v > 0 else BLUE for v in values], height=0.6)
    ax.invert_yaxis()
    ax.axvline(0, color="#444444", lw=1)
    ax.set_yticks(range(len(ordered)))
    ax.set_yticklabels(labels, fontsize=9)
    ax.bar_label(bars, labels=[f"{v:+.2f}" for v in values], padding=3, fontsize=9)
    span = max(abs(v) for v in values)
    ax.set_xlim(-span * 1.3, span * 1.3)
    ax.set_xlabel("Contribution SHAP (log-odds)", fontsize=9)
    ax.grid(axis="y", visible=False)
    ax.legend(
        handles=[Patch(color=RED, label="Augmente le risque de défaut"), Patch(color=BLUE, label="Réduit le risque")],
        loc="upper center", bbox_to_anchor=(0.5, -0.22), ncol=2, fontsize=8, frameon=False,
    )
    fig.patch.set_facecolor("white")
    fig.tight_layout()
    return fig


def fetch_health():
    """État de l'API (None si injoignable)."""
    try:
        resp = requests.get(f"{API_URL}/health", timeout=3)
        return resp.json() if resp.ok else None
    except requests.RequestException:
        return None


def show_result(result):
    """Affiche probabilité, décision et facteurs d'un client à partir de la réponse de l'API."""
    probability, threshold = result["default_probability"], result["threshold"]
    refused = result["decision"] == "refusé"

    col_gauge, col_decision = st.columns([3, 2])
    with col_gauge:
        st.metric("Probabilité de défaut estimée", f"{probability:.1%}")
        fig = gauge_figure(probability, threshold, refused)
        st.pyplot(fig)
        plt.close(fig)
    with col_decision:
        if refused:
            st.error(f"**Crédit refusé**\n\nProbabilité de défaut ({probability:.1%}) supérieure ou égale "
                     f"au seuil de {threshold:.0%}.")
        else:
            st.success(f"**Crédit accordé**\n\nProbabilité de défaut ({probability:.1%}) inférieure "
                       f"au seuil de {threshold:.0%}.")

    st.subheader("Facteurs qui ont le plus influencé cette décision")
    st.caption("Contributions SHAP locales pour ce client : chaque barre indique de combien la variable "
               "pousse la décision vers le refus (rouge) ou vers l'acceptation (bleu).")
    fig = factors_figure(result["top_factors"])
    st.pyplot(fig)
    plt.close(fig)


def main():
    st.set_page_config(page_title="Credit Scoring", layout="wide")
    st.title("Évaluation du risque de défaut d'un client")

    health = fetch_health()
    if health:
        st.sidebar.success(f"API connectée\n\nModèle : {health['model']}\n\nSeuil : {health['threshold']}")
    else:
        st.sidebar.error(f"API injoignable ({API_URL})")

    with st.form("client_form"):
        col1, col2, col3 = st.columns(3)
        with col1:
            st.markdown("**Profil**")
            age = st.number_input("Âge (années)", min_value=18, max_value=100, value=45, step=1)
            income = st.number_input("Revenu mensuel", min_value=0, max_value=1_000_000, value=5400, step=100)
            income_unknown = st.checkbox("Revenu inconnu", help="La valeur saisie ci-dessus est alors ignorée.")
            dependents = st.number_input("Personnes à charge", min_value=0, max_value=20, value=0, step=1)
            dependents_unknown = st.checkbox("Personnes à charge inconnues")
        with col2:
            st.markdown("**Endettement et crédits**")
            revolving = st.number_input(
                "Utilisation du crédit renouvelable", min_value=0.0, max_value=10.0, value=0.30, step=0.05,
                help="Part utilisée des lignes de crédit renouvelables : 0.30 = 30 %.",
            )
            debt_ratio = st.number_input(
                "Taux d'endettement (dettes / revenu)", min_value=0.0, max_value=100.0, value=0.35, step=0.05,
            )
            open_lines = st.number_input("Crédits et lignes ouverts", min_value=0, max_value=60, value=8, step=1)
            real_estate = st.number_input("Prêts immobiliers", min_value=0, max_value=20, value=1, step=1)
        with col3:
            st.markdown("**Historique de retards de paiement**")
            late_30_59 = st.number_input("Retards de 30 à 59 jours", min_value=0, max_value=20, value=0, step=1)
            late_60_89 = st.number_input("Retards de 60 à 89 jours", min_value=0, max_value=20, value=0, step=1)
            late_90 = st.number_input("Retards de 90 jours et plus", min_value=0, max_value=20, value=0, step=1)
        submitted = st.form_submit_button("Évaluer le client", type="primary")

    if submitted:
        # Noms de colonnes d'origine du dataset, comme attendu par l'API
        payload = {
            "RevolvingUtilizationOfUnsecuredLines": float(revolving),
            "age": int(age),
            "NumberOfTime30-59DaysPastDueNotWorse": int(late_30_59),
            "DebtRatio": float(debt_ratio),
            "MonthlyIncome": None if income_unknown else float(income),
            "NumberOfOpenCreditLinesAndLoans": int(open_lines),
            "NumberOfTimes90DaysLate": int(late_90),
            "NumberRealEstateLoansOrLines": int(real_estate),
            "NumberOfTime60-89DaysPastDueNotWorse": int(late_60_89),
            "NumberOfDependents": None if dependents_unknown else int(dependents),
        }
        try:
            resp = requests.post(f"{API_URL}/predict", params={"explain": "true"}, json=payload, timeout=10)
        except requests.RequestException:
            st.error(f"Impossible de joindre l'API à l'adresse {API_URL}. Vérifiez qu'elle est démarrée.")
        else:
            if resp.status_code == 200:
                show_result(resp.json())
            elif resp.status_code == 422:
                st.error("Données invalides :\n\n" + "\n".join(
                    f"- **{d['field']}** : {d['message']}" for d in resp.json()["details"]))
            else:
                st.error(f"Erreur de l'API (code {resp.status_code}) : {resp.text}")

    st.divider()
    threshold_text = f"Le seuil de décision ({health['threshold']})" if health else "Le seuil de décision"
    st.caption(
        f"{threshold_text} repose sur une **hypothèse de coût illustrative (k = 10)** : accorder un crédit à un "
        "mauvais payeur est supposé coûter 10 fois plus que refuser un bon client. Les vrais coûts d'une banque "
        "donneraient un autre seuil. Ce dashboard est un **projet portfolio à visée pédagogique**, pas un outil "
        "de décision de crédit réel."
    )


if __name__ == "__main__":
    main()
