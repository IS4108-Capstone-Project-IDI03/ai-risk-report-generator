"""Numeric scoring for the table OCR comparison (IN-12): no network, no files."""

from eval.ocr.scoring import number_scores


def test_recall_counts_repeats_and_precision_counts_distinct_numbers():
    # PDF prints 70 and 0.0391 twice (6 numbers). The reading drops one 0.0391 and
    # misreads 2.2538 as 2.2583: 4 of 6 printed numbers found; of the 4 distinct
    # numbers read (70, 2.2075, 0.0391, 2.2583), 3 exist in the PDF.
    text_layer = "Temp 70 70\nVolume 2.2075 2.2538\nW/V 0.0391 0.0391"
    reading = "Temp: 70; Volume: 2.2075; W/V: 0.0391\nTemp: 70; Volume: 2.2583"

    recall, precision = number_scores(reading, text_layer)

    assert (recall, precision) == (4 / 6, 3 / 4)


def test_a_heading_repeated_on_every_record_is_not_a_misread():
    # Records repeat each heading per row, so "ft3" appears twice in the reading
    # though printed once; every number read is still in the PDF.
    text_layer = "Volume (ft3)\n2.2075\n2.2538"
    reading = "Volume (ft3): 2.2075\nVolume (ft3): 2.2538"

    assert number_scores(reading, text_layer) == (1.0, 1.0)
