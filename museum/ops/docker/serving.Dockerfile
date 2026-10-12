FROM python:3.11.13-slim-bookworm
WORKDIR /museum/serving
COPY serving/requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
COPY serving/ ./
COPY caption/ /museum/caption/
COPY contracts/ /museum/contracts/
COPY models/manifest.yaml /museum/models/manifest.yaml
CMD ["python", "-m", "model_api.main"]
