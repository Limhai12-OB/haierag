package com.haierag.common;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/** Renders every error as RFC 7807 {@code application/problem+json}. */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    public static ProblemDetail problem(HttpStatusCode status, String detail, String instance) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, detail);
        HttpStatus resolved = HttpStatus.resolve(status.value());
        pd.setTitle(resolved != null ? resolved.getReasonPhrase() : "Error");
        if (instance != null) {
            pd.setInstance(URI.create(instance));
        }
        return pd;
    }

    private static ResponseEntity<Object> respond(ProblemDetail pd, HttpHeaders headers) {
        HttpHeaders h = new HttpHeaders();
        if (headers != null) {
            h.addAll(headers);
        }
        h.setContentType(MediaType.APPLICATION_PROBLEM_JSON);
        return ResponseEntity.status(pd.getStatus()).headers(h).body(pd);
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Object> handleApi(ApiException ex, HttpServletRequest req) {
        ProblemDetail pd = problem(ex.getStatus(), ex.getMessage(), req.getRequestURI());
        if (ex.getErrors() != null && !ex.getErrors().isEmpty()) {
            pd.setProperty("errors", ex.getErrors());
        }
        HttpHeaders headers = new HttpHeaders();
        if (ex instanceof RateLimitedException rl) {
            headers.set(HttpHeaders.RETRY_AFTER, Long.toString(rl.getRetryAfterSeconds()));
        }
        return respond(pd, headers);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<Object> handleConstraint(ConstraintViolationException ex, HttpServletRequest req) {
        Map<String, String> errors = new LinkedHashMap<>();
        ex.getConstraintViolations().forEach(v -> errors.put(v.getPropertyPath().toString(), v.getMessage()));
        ProblemDetail pd = problem(HttpStatus.BAD_REQUEST, "Validation failed", req.getRequestURI());
        pd.setProperty("errors", errors);
        return respond(pd, null);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Object> handleTypeMismatch(MethodArgumentTypeMismatchException ex, HttpServletRequest req) {
        ProblemDetail pd = problem(HttpStatus.BAD_REQUEST, "Invalid value for '" + ex.getName() + "'", req.getRequestURI());
        return respond(pd, null);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Object> handleAccessDenied(AccessDeniedException ex, HttpServletRequest req) {
        return respond(problem(HttpStatus.FORBIDDEN, "Access denied", req.getRequestURI()), null);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Object> handleUnexpected(Exception ex, HttpServletRequest req) {
        log.error("Unhandled error on {} {}", req.getMethod(), req.getRequestURI(), ex);
        return respond(problem(HttpStatus.INTERNAL_SERVER_ERROR, "Unexpected server error", req.getRequestURI()), null);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex, HttpHeaders headers,
                                                                  HttpStatusCode status, WebRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        for (FieldError fe : ex.getBindingResult().getFieldErrors()) {
            errors.putIfAbsent(fe.getField(), fe.getDefaultMessage());
        }
        ex.getBindingResult().getGlobalErrors().forEach(ge -> errors.putIfAbsent(ge.getObjectName(), ge.getDefaultMessage()));
        ProblemDetail pd = problem(HttpStatus.BAD_REQUEST, "Validation failed", path(request));
        pd.setProperty("errors", errors);
        return respond(pd, null);
    }

    @Override
    protected ResponseEntity<Object> handleMaxUploadSizeExceededException(MaxUploadSizeExceededException ex, HttpHeaders headers,
                                                                          HttpStatusCode status, WebRequest request) {
        return respond(problem(HttpStatus.CONTENT_TOO_LARGE, "File exceeds the maximum upload size", path(request)), null);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
                                                             HttpStatusCode statusCode, WebRequest request) {
        ProblemDetail pd;
        if (body instanceof ProblemDetail existing) {
            pd = existing;
            if (pd.getTitle() == null) {
                HttpStatus resolved = HttpStatus.resolve(statusCode.value());
                pd.setTitle(resolved != null ? resolved.getReasonPhrase() : "Error");
            }
            if (pd.getInstance() == null && path(request) != null) {
                pd.setInstance(URI.create(path(request)));
            }
        } else {
            pd = problem(statusCode, ex.getMessage(), path(request));
        }
        return respond(pd, headers);
    }

    private static String path(WebRequest request) {
        String desc = request.getDescription(false);
        return desc.startsWith("uri=") ? desc.substring(4) : null;
    }
}
