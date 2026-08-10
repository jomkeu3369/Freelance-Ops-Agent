from transformers import AutoModel, AutoTokenizer

def bart_classification_route(prompt: str) -> str:
    model_id = "LiquidAI/LFM2.5-Encoder-350-Prompt-Router"
    
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModel.from_pretrained(model_id, trust_remote_code=True).eval()

    routes = ["Coding", "Sales", "Creative writing", "General knowledge"]
    prompt = "Can you help me debug a failing Python unit test?"
    
    return model.route(prompt, routes, tokenizer=tokenizer)