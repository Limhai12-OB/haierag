package com.haierag.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import com.haierag.user.UserDto;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 320) String email,
            @NotBlank @Size(min = 8, max = 128, message = "must be between 8 and 128 characters") String password,
            @NotBlank @Size(max = 120) String displayName) {
    }

    public record LoginRequest(@NotBlank @Size(max = 320) String email, @NotBlank @Size(max = 128) String password) {
    }

    public record UpdateMeRequest(@NotBlank @Size(max = 120) String displayName) {
    }

    public record AuthResponse(String accessToken, String tokenType, long expiresIn, UserDto user) {
    }

    /** Service result: the public response plus the raw refresh token destined for the cookie only. */
    public record AuthResult(AuthResponse response, String refreshToken) {
    }
}
