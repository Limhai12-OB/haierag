package com.haierag.document;

import java.util.Locale;
import java.util.Optional;

public enum FileType {
    PDF("application/pdf"),
    DOCX("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    XLSX("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    PPTX("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    TXT("text/plain; charset=utf-8"),
    MARKDOWN("text/markdown; charset=utf-8"),
    CSV("text/csv; charset=utf-8"),
    /** Web pages imported from a link (never accepted as an upload; see {@link FileValidator}). */
    HTML("text/html");

    private final String contentType;

    FileType(String contentType) {
        this.contentType = contentType;
    }

    public String contentType() {
        return contentType;
    }

    public boolean isText() {
        return this == TXT || this == MARKDOWN || this == CSV || this == HTML;
    }

    public static Optional<FileType> fromFilename(String filename) {
        if (filename == null) {
            return Optional.empty();
        }
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) {
            return Optional.empty();
        }
        return switch (filename.substring(dot + 1).toLowerCase(Locale.ROOT)) {
            case "pdf" -> Optional.of(PDF);
            case "docx" -> Optional.of(DOCX);
            case "xlsx" -> Optional.of(XLSX);
            case "pptx" -> Optional.of(PPTX);
            case "txt", "text" -> Optional.of(TXT);
            case "md", "markdown" -> Optional.of(MARKDOWN);
            case "csv" -> Optional.of(CSV);
            default -> Optional.empty();
        };
    }
}
