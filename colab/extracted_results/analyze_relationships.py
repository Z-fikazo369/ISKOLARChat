import pandas as pd

# Load data
summary = pd.read_csv('summary.csv')
baseline = pd.read_csv('results_baseline.csv')
agentic = pd.read_csv('results_agentic.csv')

print("=" * 80)
print("BASELINE: Cases with LOW Context Recall")
print("=" * 80)
low_recall_baseline = baseline[baseline['context_recall'] < 0.5].head(3)
for idx, row in low_recall_baseline.iterrows():
    print(f"\nQuestion: {row['user_input'][:70]}")
    print(f"  Context Recall: {row['context_recall']:.3f} (BAD - didn't find the info)")
    print(f"  Faithfulness: {row['faithfulness']:.3f}")
    print(f"  Answer Relevancy: {row['answer_relevancy']:.3f}")
    print(f"  Context Precision: {row['context_precision']:.3f}")
    print(f"  Why: System searched but couldn't locate the right information in KB")

print("\n" + "=" * 80)
print("BASELINE: HIGH Context Recall but LOW Answer Relevancy")
print("=" * 80)
good_recall_bad_rel = baseline[(baseline['context_recall'] > 0.8) & (baseline['answer_relevancy'] < 0.4)].head(2)
if len(good_recall_bad_rel) > 0:
    for idx, row in good_recall_bad_rel.iterrows():
        print(f"\nQuestion: {row['user_input'][:70]}")
        print(f"  Context Recall: {row['context_recall']:.3f} (GOOD - found the info)")
        print(f"  Answer Relevancy: {row['answer_relevancy']:.3f} (BAD - answer off-topic)")
        print(f"  Faithfulness: {row['faithfulness']:.3f}")
        print(f"  Why: System found right info but answer drifted to different topic")
else:
    print("\nNo cases found - baseline generally doesn't have this problem")

print("\n" + "=" * 80)
print("AGENTIC: HIGH Precision but LOW Recall cases")
print("=" * 80)
high_prec_low_recall = agentic[(agentic['context_precision'] > 0.8) & (agentic['context_recall'] < 0.5)].head(2)
if len(high_prec_low_recall) > 0:
    for idx, row in high_prec_low_recall.iterrows():
        print(f"\nQuestion: {row['user_input'][:70]}")
        print(f"  Context Precision: {row['context_precision']:.3f} (GOOD - focused chunks)")
        print(f"  Context Recall: {row['context_recall']:.3f} (BAD - incomplete context)")
        print(f"  Answer Relevancy: {row['answer_relevancy']:.3f}")
        print(f"  Faithfulness: {row['faithfulness']:.3f}")
        print(f"  Why: Sub-queries were focused but too narrow - missed some context needed")
else:
    print("\nNo significant cases found")

print("\n" + "=" * 80)
print("METRIC CORRELATION SUMMARY")
print("=" * 80)

# Calculate correlations
baseline_corr = baseline[['faithfulness', 'answer_relevancy', 'context_recall', 'context_precision']].corr()
agentic_corr = agentic[['faithfulness', 'answer_relevancy', 'context_recall', 'context_precision']].corr()

print("\nBASELINE Metric Correlations:")
print(baseline_corr.round(3))

print("\nAGENTIC Metric Correlations:")
print(agentic_corr.round(3))
