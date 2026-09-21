import pytest

import app.api.uploads as uploads

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x24\x00\x00\x00WEBP" + b"\x00" * 64


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def tmp_upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(uploads, "UPLOAD_DIR", tmp_path)
    return tmp_path


@pytest.mark.parametrize(("data", "ext"), [(JPEG, ".jpg"), (PNG, ".png"), (WEBP, ".webp")])
def test_admin_can_upload_supported_images(client, admin_token, tmp_upload_dir, data, ext) -> None:
    response = client.post(
        "/uploads/products", files={"file": ("foto.bin", data, "application/octet-stream")}, headers=_auth(admin_token)
    )
    assert response.status_code == 201
    url = response.json()["url"]
    assert url.startswith("/uploads/") and url.endswith(ext)
    assert (tmp_upload_dir / url.rsplit("/", 1)[1]).read_bytes() == data


def test_upload_rejects_non_image_even_with_image_content_type(client, admin_token) -> None:
    response = client.post(
        "/uploads/products", files={"file": ("x.jpg", b"<script>alert(1)</script>", "image/jpeg")}, headers=_auth(admin_token)
    )
    assert response.status_code == 400


def test_upload_rejects_files_over_5mb(client, admin_token) -> None:
    big = JPEG + b"\x00" * (5 * 1024 * 1024)
    response = client.post("/uploads/products", files={"file": ("big.jpg", big, "image/jpeg")}, headers=_auth(admin_token))
    assert response.status_code == 413


def test_customer_cannot_upload(client, customer_token) -> None:
    response = client.post("/uploads/products", files={"file": ("a.jpg", JPEG, "image/jpeg")}, headers=_auth(customer_token))
    assert response.status_code == 403


def test_anonymous_cannot_upload(client) -> None:
    response = client.post("/uploads/products", files={"file": ("a.jpg", JPEG, "image/jpeg")})
    assert response.status_code in (401, 403)
