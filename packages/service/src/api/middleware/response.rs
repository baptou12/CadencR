use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};

pub fn unauthorized() -> Response {
    let mut resp = (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    resp.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static("Cadence-Token"),
    );
    resp
}

pub fn misdirected() -> Response {
    (StatusCode::MISDIRECTED_REQUEST, "host not allowed").into_response()
}

pub fn forbidden(reason: &'static str) -> Response {
    (StatusCode::FORBIDDEN, reason).into_response()
}
