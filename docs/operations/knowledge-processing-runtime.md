# Knowledge processing runtime

QuantXY keeps document processing outside the business request path. The application claims durable Supabase jobs, a dedicated worker invokes the internal processing route, and the authenticated processor gateway uses three network-isolated services:

- `clamav/clamav:1.5.4` for malware scanning. ClamAV is GPL-2.0 and runs as an unmodified sidecar with a persistent signature database.
- `quay.io/unstructured-io/unstructured-api:0.1.2` for PDF, Office, text and OCR-aware extraction. Unstructured API is Apache-2.0.
- `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3` for local CPU inference. TEI is Apache-2.0.
- `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` at revision `383bbb10e05bb8885acd71a7956dc2d823b60305` for 384-dimensional multilingual embeddings. The model card declares Apache-2.0.

The sidecars publish no host ports. Only the application container can reach them on the private Compose network. The public processor route requires a dedicated constant-time-checked secret, accepts only supported job types, caps file and text sizes, checks the source byte count and SHA-256, and downloads only HTTPS signed URLs from the exact configured Supabase host after public-address validation. Unstructured and TEI targets are fixed to internal service names, not caller-controlled URLs.

Before Staging startup, resolve every image tag to a digest and record it in the release manifest. On the first start, allow ClamAV definitions and the pinned embedding model to populate their named volumes. Do not mark knowledge processing healthy until all of these checks pass:

1. ClamAV accepts a clean file and rejects the EICAR test fixture.
2. PDF, DOCX, XLSX, PPTX, TXT/Markdown, CSV, HTML and JSON samples complete scan, parse and vector jobs.
3. Hash mismatch, unsupported MIME type, private/redirected source URL and invalid processor secret fail closed.
4. Chinese and English queries return permission-filtered citations to the expected document version.
5. Container restart preserves antivirus definitions and model cache, while pending jobs resume without duplicate chunks.
