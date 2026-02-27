import uvicorn
import logging

if __name__ == "__main__":
    logging.info("Starting up Senorita backend...")
    # Point uvicorn to run from app.main:app
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
