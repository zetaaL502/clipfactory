from huggingface_hub import HfApi

TOKEN = "PASTE_YOUR_HF_TOKEN_HERE"

api = HfApi()
print("Uploading to HF Space... please wait")
api.upload_folder(
    folder_path=".",
    repo_id="saksham584345843/clip-factory",
    repo_type="space",
    token=TOKEN,
    ignore_patterns=[
        ".git", "node_modules", "dist", "__pycache__",
        "picker_jobs", "clips", "*.log", "*.zip",
        "deploy_to_hf.py", "attached_assets"
    ]
)
print("Done! Go check your Space — it should start building now.")
