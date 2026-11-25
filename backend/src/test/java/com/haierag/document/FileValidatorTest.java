package com.haierag.document;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.haierag.common.ApiException;
import com.haierag.support.Files;

class FileValidatorTest {

    @TempDir
    Path dir;

    private final FileValidator validator = new FileValidator();

    private Path write(byte[] bytes) throws Exception {
        Path p = java.nio.file.Files.createTempFile(dir, "f", ".bin");
        java.nio.file.Files.write(p, bytes);
        return p;
    }

    @Test
    void detectsValidTypes() throws Exception {
        assertThat(validator.validate("a.PDF", write(Files.pdf()))).isEqualTo(FileType.PDF);
        assertThat(validator.validate("a.docx", write(Files.docx()))).isEqualTo(FileType.DOCX);
        assertThat(validator.validate("a.markdown", write("# hi".getBytes(StandardCharsets.UTF_8)))).isEqualTo(FileType.MARKDOWN);
        // UTF-8 with BOM and multi-byte characters across buffer boundaries
        byte[] khmer = ("\uFEFF" + "ក".repeat(40_000)).getBytes(StandardCharsets.UTF_8);
        assertThat(validator.validate("k.txt", write(khmer))).isEqualTo(FileType.TXT);
    }

    @Test
    void rejectsMismatches() throws Exception {
        assertThatThrownBy(() -> validator.validate("a.pdf", write("PDF-".getBytes(StandardCharsets.UTF_8))))
                .isInstanceOf(ApiException.class).extracting("status").hasToString("415 UNSUPPORTED_MEDIA_TYPE");
        assertThatThrownBy(() -> validator.validate("a.pptx", write(Files.docx()))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> validator.validate("a.txt", write(new byte[]{(byte) 0xC3}))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> validator.validate("a", write(Files.pdf()))).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> validator.validate("a.docx", write(new byte[]{0x50, 0x4B, 0x03, 0x04, 1, 2})))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void safeFilenames() {
        assertThat(DocumentService.safeFilename("../../etc/passwd")).isEqualTo("passwd");
        assertThat(DocumentService.safeFilename("Résumé final.pdf")).isEqualTo("R_sum_final.pdf");
        assertThat(DocumentService.safeFilename("....")).isEqualTo("file");
        assertThat(DocumentService.safeFilename("a".repeat(300) + ".docx")).hasSize(120).endsWith(".docx");
        assertThat(DocumentService.sanitizeOriginalName("C:\\Users\\me\\doc.pdf")).isEqualTo("doc.pdf");
    }
}
