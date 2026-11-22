import 'dart:convert';

import 'package:material_ui/material_ui.dart';

import '../../data/actions.dart';
import '../../data/channels.dart';
import '../../i18n/i18n.dart';
import '../../protocol/json.dart';
import '../session/approval_card.dart';
import '../settings/log_screen.dart' show showErrorSnack;

String _status(Object? status) => switch (status) {
  'planning' => L('拟计划中', 'Planning'),
  'draft' => L('待确认', 'Draft'),
  'pending' => L('待开始', 'Pending'),
  'running' => L('进行中', 'Running'),
  'paused' => L('已暂停', 'Paused'),
  'asking' => L('待回答', 'Awaiting answer'),
  'gated' => L('待验收', 'Awaiting review'),
  'delivered' => L('已交付', 'Delivered'),
  'failed' => L('失败', 'Failed'),
  'stopped' => L('已停止', 'Stopped'),
  'done' => L('完成', 'Done'),
  _ => status?.toString() ?? '',
};

class ChannelFlowCard extends StatefulWidget {
  const ChannelFlowCard({
    super.key,
    required this.entry,
    required this.flow,
    required this.members,
    required this.timeline,
    required this.canAct,
  });
  final ChannelEntry entry;
  final Json flow;
  final Map<String, ChannelMember> members;
  final ChannelTimeline timeline;
  final bool canAct;
  @override
  State<ChannelFlowCard> createState() => _ChannelFlowCardState();
}

class _ChannelFlowCardState extends State<ChannelFlowCard> {
  bool _starting = false;

  Future<void> _start() async {
    setState(() => _starting = true);
    try {
      await widget.timeline.flow(widget.entry.id, [
        'start',
        widget.flow['rev'],
      ]);
    } catch (error) {
      if (mounted) showErrorSnack(context, actionError(error));
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Widget _questions(
    List<Json> questions,
    List<Object?> Function(List<String>) action,
    String version,
  ) {
    final request = Approval({
      'requestId': widget.entry.id,
      'kind': 'question',
      'title': L('计划提问', 'Plan question'),
      'canDeny': false,
      'questions': [
        for (var i = 0; i < questions.length; i++)
          {
            'answerKey': '$i',
            'question': questions[i]['q'],
            'options': [
              for (final option in questions[i]['options'] as List? ?? const [])
                {'label': option},
            ],
          },
      ],
    });
    return ApprovalCard(
      key: ValueKey(version),
      request: request,
      canAct: widget.canAct,
      onAnswer: (decision) => widget.timeline.flow(
        widget.entry.id,
        action([
          for (var i = 0; i < questions.length; i++)
            obj(decision['answers'])['$i'] as String,
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final flow = widget.flow;
    final steps = objList(flow['steps']);
    final questions = objList(flow['questions']);
    final pending =
        flow['status'] == 'draft' &&
        questions.any((q) => str(q['answer']) == null);
    final brief = obj(flow['brief']);
    final labels = {for (final step in steps) step['id']: step['title']};
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              L('计划 · ', 'Plan · ') + (str(flow['title']) ?? ''),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(_status(flow['status'])),
            if (str(brief['goal']) case final goal? when goal.isNotEmpty)
              Text(goal),
            for (final fact in objList(brief['facts']))
              Text('${fact['k']} · ${fact['v']}'),
            for (final item in objList(brief['open']))
              if (flow['status'] == 'draft' && !pending)
                _questions(
                  [item],
                  (answers) => [
                    'briefAnswer',
                    item['q'],
                    answers.first,
                    flow['rev'],
                  ],
                  '${flow['rev']}/${item['q']}',
                )
              else
                Text('${item['q']}'),
            for (final step in steps) ...[
              const Divider(),
              Text('${step['title']}'),
              Text(
                [
                  widget.members[str(step['memberId'])]?.name,
                  _status(step['status']),
                ].whereType<String>().join(' · '),
              ),
              if (step['deps'] case final List deps when deps.isNotEmpty)
                Text(
                  L('依赖 · ', 'Depends on · ') +
                      deps.map((id) => labels[id] ?? id).join('、'),
                ),
              if (objOrNull(step['question']) case final q?)
                _questions(
                  [
                    {'q': q['text']},
                  ],
                  (answers) => ['answer', step['id'], answers.first, q['at']],
                  '${step['id']}/${q['at']}',
                ),
            ],
            if (pending)
              _questions(
                questions,
                (answers) => [
                  'answers',
                  answers,
                  [for (final q in questions) q['q']],
                ],
                jsonEncode(questions),
              )
            else
              for (final q in questions)
                Text('${q['q']} · ${q['answer'] ?? ''}'),
            if (widget.canAct &&
                flow['status'] == 'draft' &&
                !pending &&
                !objList(brief['open']).any((q) => q['required'] == true) &&
                steps.isNotEmpty)
              TextButton.icon(
                onPressed: _starting ? null : _start,
                icon: const Icon(Icons.play_arrow),
                label: Text(L('按计划开工', 'Start plan')),
              ),
          ],
        ),
      ),
    );
  }
}
