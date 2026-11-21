import 'package:material_ui/material_ui.dart';

import '../../data/actions.dart';
import '../../i18n/i18n.dart';
import '../../protocol/constants.dart';
import '../../protocol/json.dart';

Future<Json?> pickPhoneModel(BuildContext context, DesktopActions desktop) =>
    showModalBottomSheet<Json>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ModelPicker(desktop),
    );

class _ModelPicker extends StatefulWidget {
  const _ModelPicker(this.desktop);
  final DesktopActions desktop;
  @override
  State<_ModelPicker> createState() => _ModelPickerState();
}

class _ModelPickerState extends State<_ModelPicker> {
  String kind = 'platform';
  String query = '';
  late Future<List<Json>> rows = load();
  Future<List<Json>> load() async {
    final selected = kind;
    final lists = await Future.wait(
      engines.keys.map((id) async {
        try {
          return await widget.desktop.modelChoices(id, selected);
        } catch (_) {
          return <Json>[];
        }
      }),
    );
    return lists.expand((list) => list).toList();
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SizedBox(
      height: MediaQuery.sizeOf(context).height * .8,
      child: Column(
        children: [
          TextField(
            decoration: InputDecoration(hintText: L('搜索全部模型', 'Search models')),
            onChanged: (v) => setState(() => query = v.trim().toLowerCase()),
          ),
          Wrap(
            children: [
              for (final tab in {
                'platform': L('平台', 'Platform'),
                'self': L('自己的账号', 'Own account'),
                'provider': L('自定义接口', 'Custom API'),
              }.entries)
                ChoiceChip(
                  label: Text(tab.value),
                  selected: kind == tab.key,
                  onSelected: (_) {
                    if (kind != tab.key) {
                      setState(() {
                        kind = tab.key;
                        rows = load();
                      });
                    }
                  },
                ),
            ],
          ),
          Expanded(
            child: FutureBuilder<List<Json>>(
              future: rows,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                final groups = <String, List<Json>>{};
                for (final r in snapshot.data ?? <Json>[]) {
                  final model = str(r['model']) ?? '';
                  if (('$model ${r['engine']} ${r['name']}')
                      .toLowerCase()
                      .contains(query)) {
                    (groups[model] ??= []).add(r);
                  }
                }
                if (groups.isEmpty) {
                  return Center(
                    child: Text(L('没有符合条件的模型', 'No matching models')),
                  );
                }
                return ListView(
                  children: [
                    for (final g in groups.entries)
                      ExpansionTile(
                        key: ValueKey('$kind/${g.key}'),
                        title: Text(g.key),
                        subtitle: Text(
                          L(
                            '${g.value.length} 个选项',
                            '${g.value.length} options',
                          ),
                        ),
                        children: [
                          for (final r in g.value)
                            ListTile(
                              title: Text(
                                '${engines[r['engine']]?.name ?? r['engine']} · ${r['name']}',
                              ),
                              subtitle: r['rate'] == null
                                  ? null
                                  : Text(
                                      '×${r['rate']} · ${r['billing'] == 'plan_only' ? L('订阅额度', 'Subscription') : L('余额计费', 'Balance billing')}',
                                    ),
                              onTap: () => Navigator.of(context).pop(r),
                            ),
                        ],
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    ),
  );
}
