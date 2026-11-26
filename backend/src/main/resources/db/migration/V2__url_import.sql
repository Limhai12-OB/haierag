-- Link import (ADR-018): documents can come from a web page or a linked file.
ALTER TABLE documents DROP CONSTRAINT documents_file_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_file_type_check
    CHECK (file_type IN ('PDF', 'DOCX', 'XLSX', 'PPTX', 'TXT', 'MARKDOWN', 'CSV', 'HTML'));

-- Final URL (after redirects) the content was downloaded from; NULL for uploaded files.
ALTER TABLE documents ADD COLUMN source_url varchar(2048);
