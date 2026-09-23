from glmocr import GlmOcr
import pymupdf
from pathlib import Path
from app.pipeline.chunking_helper.image_crop import crop_section

table_parser: GlmOcr | None = None

def get_table_parser() -> GlmOcr:
    global table_parser
    if table_parser is None:
        config_path = Path(__file__).parent.parent.parent.parent / "config.yml"
        table_parser = GlmOcr(config_path=config_path)
    return table_parser

def load_document(file_path) -> pymupdf.Document:
    """
    Load a pdf if not already loaded, and return the pymupdf.Document object
    Else return the already loaded document.
    """
    global document, document_name
    if document is None or document_name != file_path:
        document_name = file_path
        document = pymupdf.open(file_path)
        return document
    else:
        return document
    
def close_table_parser_document():
    """
    Close the loaded document if it exists.
    Run this at the end of
    """
    global document, document_name
    if document is not None:
        document.close()
        document = None
        document_name = None
                
def parse_table(bbox, page, file_path, coord_origin=""):
    parser = get_table_parser()
    document = load_document(file_path)
    
    cropped_section = crop_section(document, bbox, page=page, coord_origin=coord_origin)
    if cropped_section is None:
        return None
    
    # GlmOcr parse takes in (images: str | bytes | Path)
    bytes_data = cropped_section.tobytes(output="png")
    result = parser.parse(bytes_data)
    print(f"Parsed table result: {result}")
    print("Markdown table:", result.to_markdown())
    return result