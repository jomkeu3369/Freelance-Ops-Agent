from __future__ import annotations

from .prototype import compare_models, generate_synthetic_history, split_history


def main() -> None:
    history = generate_synthetic_history(5_000, random_seed=42)
    training, validation = split_history(history, random_seed=42)
    metrics = compare_models(training, validation, random_seed=42)

    print(f"samples: {len(history)}")
    print(f"training: {len(training)}")
    print(f"validation: {len(validation)}")
    for model, result in metrics.items():
        print(f"\n{model}")
        print(f"MAE: {result.mae_seconds:.2f} sec")
        print(f"RMSE: {result.rmse_seconds:.2f} sec")
        print(f"R2: {result.r2:.3f}")


if __name__ == "__main__":
    main()
