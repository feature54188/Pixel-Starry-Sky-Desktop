import 'package:material_ui/material_ui.dart';

import '../../data/actions.dart';
import '../../data/channels.dart';
import '../../i18n/i18n.dart';
import '../settings/log_screen.dart' show showErrorSnack;

class ChannelComposer extends StatefulWidget {
  const ChannelComposer({
    super.key,
    required this.members,
    required this.send,
    required this.canAct,
    required this.inThread,
    required this.quote,
    required this.clearQuote,
  });
  final List<ChannelMember> members;
  final Future<void> Function(String) send;
  final bool canAct;
  final bool inThread;
  final ChannelEntry? quote;
  final VoidCallback clearQuote;
  @override
  State<ChannelComposer> createState() => _ChannelComposerState();
}

class _ChannelComposerState extends State<ChannelComposer> {
  final _text = TextEditingController();
  bool _sending = false;

  void _mention(String name) {
    final selection = _text.selection;
    final start = selection.isValid ? selection.start : _text.text.length;
    final end = selection.isValid ? selection.end : start;
    final prefix = _text.text.substring(0, start);
    final space = prefix.isNotEmpty && !RegExp(r'\s$').hasMatch(prefix);
    final insert = '${space ? ' ' : ''}@$name ';
    _text.value = TextEditingValue(
      text: _text.text.replaceRange(start, end, insert),
      selection: TextSelection.collapsed(offset: start + insert.length),
    );
    setState(() {});
  }

  Future<void> _send() async {
    if (_sending || !widget.canAct || _text.text.trim().isEmpty) return;
    setState(() => _sending = true);
    try {
      await widget.send(_text.text.trim());
      if (mounted) _text.clear();
    } catch (error) {
      if (mounted) showErrorSnack(context, actionError(error));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.quote case final quote?)
          Row(
            children: [
              Expanded(
                child: Text(
                  L('回复 · ', 'Reply · ') +
                      (quote.kind == 'task' ? quote.title : quote.text),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                tooltip: L('取消引用', 'Cancel reply'),
                icon: const Icon(Icons.close),
                onPressed: _sending ? null : widget.clearQuote,
              ),
            ],
          ),
        if (!widget.canAct && _text.text.isEmpty)
          Text(L('当前连接只可查看', 'This connection is read only'))
        else
          Row(
            children: [
              PopupMenuButton<String>(
                icon: const Icon(Icons.alternate_email),
                tooltip: L('提及成员', 'Mention a member'),
                enabled:
                    widget.canAct && !_sending && widget.members.isNotEmpty,
                onSelected: _mention,
                itemBuilder: (_) => [
                  for (final m in widget.members.where((m) => !m.you))
                    PopupMenuItem(value: m.name, child: Text(m.name)),
                  if (widget.members.any((m) => m.agent))
                    PopupMenuItem(
                      value: L('全体', 'all'),
                      child: Text(L('@全体', '@all')),
                    ),
                ],
              ),
              Expanded(
                child: TextField(
                  controller: _text,
                  enabled: widget.canAct && !_sending,
                  minLines: 1,
                  maxLines: 4,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: widget.inThread
                        ? L('回复讨论串', 'Reply in thread')
                        : L('发到频道', 'Message channel'),
                  ),
                ),
              ),
              IconButton(
                tooltip: L('发送', 'Send'),
                onPressed:
                    _sending || !widget.canAct || _text.text.trim().isEmpty
                    ? null
                    : _send,
                icon: _sending
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.send),
              ),
            ],
          ),
      ],
    ),
  );
}
