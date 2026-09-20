"""Nettoyage et feature engineering de la phase 2, rejoués à l'identique sur de nouvelles données.

Les statistiques (médianes, mode, seuils de capping) sont apprises UNIQUEMENT sur le train
(`fit_cleaning_params`), puis appliquées telles quelles (`apply_cleaning`) à n'importe quel
jeu de données, test compris : aucun refit, uniquement des transformations.
"""
import pandas as pd

TARGET = "SeriousDlqin2yrs"
LATE_COLS = [
    "NumberOfTime30-59DaysPastDueNotWorse",
    "NumberOfTime60-89DaysPastDueNotWorse",
    "NumberOfTimes90DaysLate",
]
SENTINELS = [96, 98]                     # codes d'erreur du système source (cf. EDA)
AGE_BINS = [0, 30, 40, 50, 60, 200]
AGE_LABELS = ["<30", "30-40", "40-50", "50-60", "60+"]
CAP_QUANTILE = 0.99


def fit_cleaning_params(train_raw):
    """Apprend sur le train brut toutes les valeurs utilisées pour imputer et capper."""
    late = train_raw[LATE_COLS].mask(train_raw[LATE_COLS].isin(SENTINELS))
    return {
        "late_medians": late.median().to_dict(),
        "income_median": train_raw["MonthlyIncome"].median(),
        "dependents_mode": train_raw["NumberOfDependents"].mode()[0],
        "age_median": train_raw["age"].where(train_raw["age"] > 0).median(),
        "debtratio_cap": train_raw["DebtRatio"].quantile(CAP_QUANTILE),
        "revolving_cap": train_raw["RevolvingUtilizationOfUnsecuredLines"].quantile(CAP_QUANTILE),
    }


def apply_cleaning(df_raw, params, scaler, feature_names, continuous_cols):
    """Applique le pipeline de la phase 2 (mêmes étapes, même ordre) avec les paramètres du train.

    Retourne les features standardisées, dans l'ordre exact attendu par le modèle.
    """
    df = df_raw.copy()

    # 1. Valeurs sentinelles 96/98 : flag, puis NaN, puis médiane apprise sur le train
    df["has_sentinel_delinquency"] = df[LATE_COLS].isin(SENTINELS).any(axis=1).astype(int)
    for col in LATE_COLS:
        df[col] = df[col].mask(df[col].isin(SENTINELS)).fillna(params["late_medians"][col])

    # 2. Valeurs manquantes : flag + médiane (revenu) / mode (personnes à charge) du train
    df["income_was_missing"] = df["MonthlyIncome"].isna().astype(int)
    df["MonthlyIncome"] = df["MonthlyIncome"].fillna(params["income_median"])
    df["dependents_was_missing"] = df["NumberOfDependents"].isna().astype(int)
    df["NumberOfDependents"] = df["NumberOfDependents"].fillna(params["dependents_mode"])

    # 3. Outliers : age <= 0 -> médiane du train ; capping aux seuils p99 du train + flag
    df["age"] = df["age"].where(df["age"] > 0).fillna(params["age_median"])
    for col, flag, cap in [
        ("DebtRatio", "debtratio_extreme", params["debtratio_cap"]),
        ("RevolvingUtilizationOfUnsecuredLines", "revolving_extreme", params["revolving_cap"]),
    ]:
        df[flag] = (df[col] > cap).astype(int)
        df[col] = df[col].clip(upper=cap)

    # 4. Features dérivées
    df["total_delinquency"] = df[LATE_COLS].sum(axis=1)
    df["income_per_dependent"] = df["MonthlyIncome"] / (df["NumberOfDependents"] + 1)
    df["has_real_estate_loan"] = (df["NumberRealEstateLoansOrLines"] > 0).astype(int)
    df["total_credit_lines"] = df["NumberOfOpenCreditLinesAndLoans"] + df["NumberRealEstateLoansOrLines"]
    age_group = pd.cut(df["age"], bins=AGE_BINS, labels=AGE_LABELS, right=False)
    # One-hot explicite (la 1re tranche "<30" est la référence) : ne dépend pas des
    # tranches présentes dans le jeu transformé, contrairement à get_dummies(drop_first=True)
    for label in AGE_LABELS[1:]:
        df[f"age_group_{label}"] = (age_group == label).astype(int)

    # 5. Standardisation avec le scaler déjà ajusté sur le train (transform uniquement)
    X = df[feature_names].astype(float)
    X[continuous_cols] = scaler.transform(X[continuous_cols])
    return X
