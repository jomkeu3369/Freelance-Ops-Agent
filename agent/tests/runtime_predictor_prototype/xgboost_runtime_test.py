import xgboost as xgb

from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, log_loss


# =========================================================
# 1. 초기 데이터 생성
# =========================================================

X, y = make_classification(
    n_samples=3000,
    n_features=20,
    n_informative=12,
    n_redundant=4,
    random_state=42
)

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.3,
    random_state=42,
    stratify=y
)

dtrain = xgb.DMatrix(X_train, label=y_train)
dtest = xgb.DMatrix(X_test, label=y_test)


# =========================================================
# 2. XGBoost 초기 학습
# =========================================================

params = {
    "objective": "binary:logistic",
    "learning_rate": 0.1,
    "max_depth": 5,
    "eval_metric": "logloss",
    "seed": 42
}

initial_rounds = 20

initial_model = xgb.train(
    params=params,
    dtrain=dtrain,
    num_boost_round=initial_rounds
)

print("초기 모델 트리 개수 :", initial_model.num_boosted_rounds())


# =========================================================
# 3. 초기 모델 저장
# =========================================================

initial_model.save_model("model.json")

print("초기 모델 저장 완료")


# =========================================================
# 4. 초기 모델 성능 확인
# =========================================================

pred_before = initial_model.predict(dtest)

pred_class_before = (pred_before >= 0.5).astype(int)

accuracy_before = accuracy_score(y_test, pred_class_before)
loss_before = log_loss(y_test, pred_before)

print("\n[초기 모델 성능]")
print("Accuracy :", accuracy_before)
print("LogLoss  :", loss_before)


# =========================================================
# 5. 새로운 데이터 생성
# =========================================================
#
# 실제 환경에서는 여기 부분이
#
# X_new = 새롭게 들어온 데이터
# y_new = 새 데이터의 정답
#
# 이 됩니다.
#
# 테스트를 위해 새로운 classification 데이터를 생성합니다.
# =========================================================

X_new, y_new = make_classification(
    n_samples=1000,
    n_features=20,
    n_informative=12,
    n_redundant=4,
    random_state=100
)

dnew = xgb.DMatrix(
    X_new,
    label=y_new
)


# =========================================================
# 6. 추가 학습하기 전 새 데이터 성능 측정
# =========================================================

pred_new_before = initial_model.predict(dnew)

pred_new_class_before = (
    pred_new_before >= 0.5
).astype(int)

new_accuracy_before = accuracy_score(
    y_new,
    pred_new_class_before
)

new_loss_before = log_loss(
    y_new,
    pred_new_before
)

print("\n[추가 학습 전 - 새 데이터 성능]")
print("Accuracy :", new_accuracy_before)
print("LogLoss  :", new_loss_before)


# =========================================================
# 7. 저장된 기존 모델 불러오기
# =========================================================

existing_model = xgb.Booster()

existing_model.load_model(
    "model.json"
)

print(
    "\n불러온 모델 트리 개수 :",
    existing_model.num_boosted_rounds()
)


# =========================================================
# 8. 새 데이터로 incremental training
# =========================================================

additional_rounds = 10

updated_model = xgb.train(
    params=params,
    dtrain=dnew,
    num_boost_round=additional_rounds,
    xgb_model=existing_model
)

print(
    "추가 학습 후 트리 개수 :",
    updated_model.num_boosted_rounds()
)


# =========================================================
# 9. 업데이트된 모델 저장
# =========================================================

updated_model.save_model(
    "model_updated.json"
)

print("업데이트 모델 저장 완료")


# =========================================================
# 10. 새 데이터 성능 다시 측정
# =========================================================

pred_new_after = updated_model.predict(
    dnew
)

pred_new_class_after = (
    pred_new_after >= 0.5
).astype(int)

new_accuracy_after = accuracy_score(
    y_new,
    pred_new_class_after
)

new_loss_after = log_loss(
    y_new,
    pred_new_after
)

print("\n[추가 학습 후 - 새 데이터 성능]")
print("Accuracy :", new_accuracy_after)
print("LogLoss  :", new_loss_after)


# =========================================================
# 11. 기존 테스트 데이터에 대해서도 확인
# =========================================================

pred_test_after = updated_model.predict(
    dtest
)

pred_test_class_after = (
    pred_test_after >= 0.5
).astype(int)

accuracy_after = accuracy_score(
    y_test,
    pred_test_class_after
)

loss_after = log_loss(
    y_test,
    pred_test_after
)

print("\n[추가 학습 후 - 기존 테스트 데이터]")
print("Accuracy :", accuracy_after)
print("LogLoss  :", loss_after)


# =========================================================
# 12. 결과 비교
# =========================================================

print("\n" + "=" * 60)
print("최종 비교")
print("=" * 60)

print(
    f"트리 개수 : "
    f"{initial_rounds}"
    f" -> "
    f"{updated_model.num_boosted_rounds()}"
)

print("\n새 데이터")
print(
    f"Accuracy : "
    f"{new_accuracy_before:.4f}"
    f" -> "
    f"{new_accuracy_after:.4f}"
)

print(
    f"LogLoss  : "
    f"{new_loss_before:.4f}"
    f" -> "
    f"{new_loss_after:.4f}"
)

print("\n기존 테스트 데이터")
print(
    f"Accuracy : "
    f"{accuracy_before:.4f}"
    f" -> "
    f"{accuracy_after:.4f}"
)

print(
    f"LogLoss  : "
    f"{loss_before:.4f}"
    f" -> "
    f"{loss_after:.4f}"
)
