export const examples = [
  {
    label: '序列比对',
    caption: '从全局和局部比对的区别讲起',
    question: '全局序列比对和局部序列比对有什么区别？',
    answer: '**全局比对**试图对齐两条序列的整个长度。两条长度接近、整体相似的序列，可以用 Needleman–Wunsch 做全局比对。\n\n**局部比对**寻找得分最高的一对片段。两条长序列只有一小段保守区域时，可以用 Smith–Waterman 找到那一段。\n\n例如，ACGT 和 TTACGTAA 有一段完全相同的 ACGT。局部比对会突出这段相同区域，全局比对还会考虑较长序列两侧的碱基。'
  },
  {
    label: '基因表达',
    caption: '读懂 fold change 和 adjusted p-value',
    question: '差异表达分析中，log₂ fold change 和调整后的 p 值分别表示什么？',
    answer: '**log₂ fold change**描述变化幅度和方向。如果实验组的表达量是对照组的两倍，它就是 +1。如果是对照组的一半，它就是 −1。\n\n**调整后的 p 值**考虑同时检验很多基因带来的多重比较问题。以 Benjamini–Hochberg 为例，筛选阈值用于控制所报告发现中的错误发现比例。\n\n读结果时把两列一起看。变化幅度描述差异有多大，统计证据还受样本数量和变异程度影响。'
  },
  {
    label: '脚本入门',
    caption: '用 Python 算出一段序列的 GC 含量',
    question: '能否用 Python 演示如何计算 DNA 序列的 GC 含量？',
    answer: 'GC 含量是 G 和 C 在所统计碱基中的比例。下面用虚构序列演示，遇到 N 等未知碱基时把它们排除在分母之外。\n\n```python\nsequence = "ATGCCN".upper()\nbases = [base for base in sequence if base in "ACGT"]\nif bases:\n    gc = sum(base in "GC" for base in bases) / len(bases)\n    print(f"{gc:.1%}")  # 60.0%\nelse:\n    print("没有可统计的碱基")\n```\n\n报告结果时应注明未知碱基如何处理，因为它会影响分母。'
  },
  {
    label: '进化分析',
    caption: '看懂系统发育树上的分支和节点',
    question: '系统发育树的节点和枝长应该怎么读？',
    answer: '**内部节点**表示所连分支的推断共同祖先。判断两条分支是否近缘，看最近共同祖先，而非它们在画面上离得多近。\n\n**枝长**的含义取决于图的类型。有的树用枝长表示估计的序列变化量，有的表示时间，有的图只表达分支关系。先查看图注和比例尺。\n\n节点附近的 bootstrap 支持度反映重新抽样后该分支出现的频率，应与枝长分开解读。'
  }
];
