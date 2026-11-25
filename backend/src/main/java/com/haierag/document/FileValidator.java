package com.haierag.document;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.haierag.common.ApiException;

/**
 * Verifies that an upload really is what its extension claims, using magic bytes (PDF), the ZIP central
 * directory (OOXML, no entry is decompressed) or strict UTF-8 decoding without NUL bytes (text types).
 */
@Component
public class FileValidator {

    private static final byte[] PDF_MAGIC = "%PDF-".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] ZIP_MAGIC = {0x50, 0x4B, 0x03, 0x04};

    public FileType validate(String originalFilename, Path file) {
        FileType type = FileType.fromFilename(originalFilename).orElseThrow(() -> unsupported(
                "Unsupported file type; allowed: PDF, DOCX, XLSX, PPTX, TXT, MD, CSV"));
        try {
            boolean ok = switch (type) {
                case PDF -> startsWith(file, PDF_MAGIC);
                case DOCX -> isOoxml(file, "word/document.xml", "word/");
                case XLSX -> isOoxml(file, "xl/workbook.xml", "xl/");
                case PPTX -> isOoxml(file, "ppt/presentation.xml", "ppt/");
                case TXT, MARKDOWN, CSV -> isUtf8Text(file);
            };
            if (!ok) {
                throw unsupported("File content does not match its ." + extension(originalFilename) + " extension");
            }
        } catch (IOException e) {
            throw unsupported("File content could not be read as " + type);
        }
        return type;
    }

    static boolean startsWith(Path file, byte[] magic) throws IOException {
        try (InputStream in = Files.newInputStream(file)) {
            byte[] head = in.readNBytes(magic.length);
            if (head.length < magic.length) {
                return false;
            }
            for (int i = 0; i < magic.length; i++) {
                if (head[i] != magic[i]) {
                    return false;
                }
            }
            return true;
        }
    }

    static boolean isOoxml(Path file, String mainPart, String partPrefix) throws IOException {
        if (!startsWith(file, ZIP_MAGIC)) {
            return false;
        }
        try (ZipFile zip = new ZipFile(file.toFile())) {
            if (zip.getEntry("[Content_Types].xml") == null) {
                return false;
            }
            if (zip.getEntry(mainPart) != null) {
                return true;
            }
            return zip.stream().anyMatch(e -> e.getName().startsWith(partPrefix));
        } catch (ZipException e) {
            return false;
        }
    }

    static boolean isUtf8Text(Path file) throws IOException {
        CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        ByteBuffer in = ByteBuffer.allocate(64 * 1024);
        CharBuffer out = CharBuffer.allocate(64 * 1024);
        try (InputStream is = Files.newInputStream(file)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = is.read(buf, 0, Math.min(buf.length, in.remaining()))) > 0) {
                for (int i = 0; i < n; i++) {
                    if (buf[i] == 0) {
                        return false;
                    }
                }
                in.put(buf, 0, n);
                in.flip();
                if (decoder.decode(in, out, false).isError()) {
                    return false;
                }
                in.compact();
                out.clear();
            }
            in.flip();
            if (decoder.decode(in, out, true).isError() || decoder.flush(out).isError()) {
                return false;
            }
            return !in.hasRemaining();
        } catch (CharacterCodingException e) {
            return false;
        }
    }

    private static String extension(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(java.util.Locale.ROOT);
    }

    private static ApiException unsupported(String detail) {
        return new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, detail);
    }
}
