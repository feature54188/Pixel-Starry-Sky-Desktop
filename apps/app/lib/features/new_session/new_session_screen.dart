// 新对话页（规则照网页版 NewTask.tsx）：居中的问候下面两颗胶囊——项目、引擎；底部和会话页一样的输入框，
// 「＋」加图片，输入框上面一颗模式胶囊（权限、模型、强度、速度，没选的用电脑上的设置）。
// 引擎默认用电脑上设的那个；换了引擎模型和强度回到电脑上的设置，权限新引擎也支持就留着。
// 建好会话但消息没发成功：再点不再新建，消息沿用同一个 ID（data/retry.dart）。
import 'package:material_ui/material_ui.dart';

import '../../app/scope.dart';
import '../../connection/desktop_link.dart';
import '../../data/actions.dart';
import '../../data/images.dart';
import '../../data/share.dart';
import '../../data/mode.dart';
import '../../data/sources.dart';
import '../../i18n/i18n.dart';
import '../../protocol/constants.dart';
import '../../protocol/json.dart';
import '../../ui/theme/tokens.dart';
import '../../ui/theme/type.dart';
import '../../ui/widgets.dart';
import '../session/approval_card.dart' show confirm;
import '../session/composer.dart';
import '../session/mode_sheet.dart';
import '../session/model_picker.dart';
import '../session/session_screen.dart';

void openNewSession(
  BuildContext context,
  String deviceId, {
  String? projectId,
  String? draft,
  SharedContent? shared,
}) {
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => NewSessionScreen(
        deviceId: deviceId,
        projectId: projectId,
        draft: draft ?? shared?.text,
        images: shared?.imagePaths ?? const [],
      ),
    ),
  );
}

/// 新会话的模式；null 都是「用电脑上的设置」
class _Mode {
  const _Mode({
    this.source,
    this.ultrafast,
    this.checks = false,
    this.thinkingSummaries,
    this.permissionMode,
    this.model,
    this.effort,
    this.fast,
    this.plan = false,
  });
  final String? permissionMode;
  final String? model;
  final String? effort;
  final bool? fast;
  final bool? ultrafast;
  final bool checks;
  final String? source;
  final bool? thinkingSummaries;

  _Mode update(Json patch) => _Mode(
    ultrafast: patch.containsKey('ultrafast')
        ? patch['ultrafast'] as bool?
        : ultrafast,
    checks: patch['checks'] as bool? ?? checks,
    source: patch.containsKey('source') ? patch['source'] as String? : source,
    model: patch.containsKey('model') ? patch['model'] as String? : model,
    effort: patch.containsKey('effort') ? patch['effort'] as String? : effort,
    permissionMode: patch.containsKey('permissionMode')
        ? patch['permissionMode'] as String?
        : permissionMode,
    fast: patch.containsKey('fast') ? patch['fast'] as bool? : fast,
    thinkingSummaries: patch.containsKey('thinkingSummaries')
        ? patch['thinkingSummaries'] as bool?
        : thinkingSummaries,
    plan: patch['plan'] as bool? ?? plan,
  );

  /// 「先出计划」：开着时权限发 plan，选的档位是批准后回到的那档（docs/mobile-app.md §15.2）
  final bool plan;

  Json toJson() => {
    if (source != null) ...sourcePatch(source!),
    'thinkingSummaries': ?thinkingSummaries,
    if (plan) ...{
      'permissionMode': 'plan',
      'planReturn': ?permissionMode,
    } else
      'permissionMode': ?permissionMode,
    'model': ?model,
    'effort': ?effort,
    'fast': ?fast,
    'ultrafast': ?ultrafast,
  };
}

class NewSessionScreen extends StatefulWidget {
  const NewSessionScreen({
    super.key,
    required this.deviceId,
    this.projectId,
    this.draft,
    this.images = const [],
  });
  final String deviceId;
  final String? projectId;

  /// 输入框里先放好的字（任务「交给 AI」）
  final String? draft;

  /// 先放进待发的图片路径（从别的 App 分享进来的，D2）
  final List<String> images;
  @override
  State<NewSessionScreen> createState() => _NewSessionScreenState();
}

class _NewSessionScreenState extends State<NewSessionScreen> {
  late final DesktopActions _desktop;
  String? _projectId;
  String? _picked;
  String? _defaultEngine;
  _Mode _mode = const _Mode();
  String _modeEngine = '';
  late final _draft = TextEditingController(text: widget.draft);
  final _images = PendingImages();
  bool _started = false;

  // 上次建好了会话、但消息没发成功：重试时不再新建
  ({String key, String id})? _created;
  SessionActions? _sending;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _desktop = DesktopActions(
      AppScope.read(context).connections,
      widget.deviceId,
    );
    _projectId = widget.projectId;
    if (widget.images.isNotEmpty) {
      _images.addPaths(widget.images);
    }
    _desktop.defaultEngine().then((e) {
      if (mounted) setState(() => _defaultEngine = e);
    });
  }

  @override
  void dispose() {
    _draft.dispose();
    _images.dispose();
    super.dispose();
  }

  String get _engine =>
      _picked ??
      (engines.containsKey(_defaultEngine) ? _defaultEngine! : 'claude');

  /// 换了引擎：模型和强度回到电脑上的设置，权限新引擎也支持就留着
  _Mode get _modeNow {
    if (_modeEngine == _engine) return _mode;
    final kept = _mode.permissionMode;
    final modes = engines[_engine]?.permissionModes ?? const <String>[];
    return _Mode(
      permissionMode: kept != null && modes.contains(kept) ? kept : null,
      plan: _mode.plan && modes.contains('plan'),
    );
  }

  void _setMode(_Mode m) => setState(() {
    _mode = m;
    _modeEngine = _engine;
  });

  String _modeText(_Mode m) {
    final chip = modeChip({
      'permissionMode': m.permissionMode ?? 'ask',
      'model': m.model,
      'effort': m.effort,
    });
    final parts = [
      if (m.source != null)
        m.source == 'self'
            ? L('自己的账号', 'My account')
            : m.source!.startsWith('provider:')
            ? L('自定义接口', 'Custom API')
            : L('平台线路', 'Platform route'),
      if (m.plan) L('先出计划', 'Plan first'),
      if (m.permissionMode != null) chip.permission,
      ?chip.model,
      ?chip.effort,
      if (m.fast != null) m.fast! ? L('快速', 'Fast') : L('普通速度', 'Normal speed'),
      if (m.thinkingSummaries != null)
        m.thinkingSummaries!
            ? L('显示思考摘要', 'Show thinking')
            : L('隐藏思考摘要', 'Hide thinking'),
    ];
    return parts.isEmpty
        ? L('用电脑上的设置', "Computer's settings")
        : parts.join(' · ');
  }

  Future<void> _create(
    String text,
    List<Attachment> images,
    String projectId,
  ) async {
    final mode = _modeNow;
    final settings = {
      'projectId': projectId,
      if (_picked != null || mode.toJson().isNotEmpty) 'engine': _engine,
      ...mode.toJson(),
    };
    final key = settings.toString();
    final connections = AppScope.read(context).connections;
    if (_created?.key != key) {
      try {
        final id = await _desktop.createSession(settings);
        _created = (key: key, id: id);
        _sending = SessionActions(connections, widget.deviceId, id);
      } catch (e) {
        if ('$e' == 'MOBILE_BAD_ARGUMENT') {
          throw Exception(
            L(
              '电脑不接受这个模式，换一个或用电脑上的设置。',
              "The computer didn't accept this mode. Pick another or use the computer's settings.",
            ),
          );
        }
        rethrow;
      }
    }
    final id = _created!.id;
    if (mode.checks) await _sending!.setChecks(true);
    await _sending!.send(text, images);
    _created = null;
    if (mounted) openSession(context, widget.deviceId, id, replace: true);
  }

  Future<void> _pickProject(
    List<({String id, String name, String path})> projects,
    String? chosen,
  ) async {
    final c = context.colors;
    final id = await showPanel<String>(
      context,
      (context) => ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.7,
        ),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
              child: Text(
                L('项目', 'Project'),
                style: TextStyle(
                  fontSize: Fs.section,
                  fontWeight: FontWeight.w600,
                  color: c.text,
                ),
              ),
            ),
            Section(
              children: [
                for (final p in projects)
                  ListRow(
                    leading: Icon(Icons.folder_outlined, color: c.textMuted),
                    title: p.name,
                    subtitle: p.path,
                    trailing: p.id == chosen
                        ? Icon(Icons.check, color: c.accentText)
                        : const SizedBox(),
                    onTap: () => Navigator.pop(context, p.id),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
    if (id != null) setState(() => _projectId = id);
  }

  Future<void> _pickEngine() async {
    final c = context.colors;
    final id = await showPanel<String>(
      context,
      (context) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
                child: Text(
                  L('引擎', 'Engine'),
                  style: TextStyle(
                    fontSize: Fs.section,
                    fontWeight: FontWeight.w600,
                    color: c.text,
                  ),
                ),
              ),
              Section(
                children: [
                  for (final e in engines.values)
                    ListRow(
                      title: e.name,
                      trailing: e.id == _engine
                          ? Icon(Icons.check, color: c.accentText)
                          : const SizedBox(),
                      onTap: () => Navigator.pop(context, e.id),
                    ),
                ],
              ),
              if (_defaultEngine != null && _picked == null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    L(
                      '默认用电脑上设的引擎。',
                      'Defaults to the engine set on the computer.',
                    ),
                    style: TextStyle(fontSize: Fs.meta, color: c.textFaint),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
    if (id != null) setState(() => _picked = id);
  }

  Future<void> _openMode() async {
    final engine = _engine;
    Future<PhoneSources?> fetchSources() async {
      try {
        return await _desktop.sources(engine, newSession: true);
      } catch (_) {
        return null;
      }
    }

    final sourcesFuture = fetchSources();
    Future<List<EngineModel>> loadModels(String? source) async {
      if (source == null || source == 'self') {
        return _desktop.catalog(engine, newSession: source == null);
      }
      final sources = await sourcesFuture;
      final ids = source.startsWith('platform:')
          ? sources?.line(source.substring(9))?.models
          : sources?.provider(source.substring(9))?.models;
      return [
        for (final id in ids ?? const <String>[])
          EngineModel({'id': id, 'label': id}),
      ];
    }

    Future<Json> loadSpeed(_Mode mode) async {
      try {
        return await _desktop.speedOption(
          engine,
          mode.source == null ? null : sourcePatch(mode.source!)['source'],
          mode.model,
        );
      } catch (_) {
        return {};
      }
    }

    var catalog = loadModels(_modeNow.source);
    var speed = loadSpeed(_modeNow);
    await showPanel<void>(
      context,
      (_) => StatefulBuilder(
        builder: (context, setSheet) => FutureBuilder<PhoneSources?>(
          future: sourcesFuture,
          builder: (context, sourceSnap) => FutureBuilder<List<EngineModel>>(
            future: catalog,
            builder: (context, snap) {
              final m = _modeNow;
              final unsupported =
                  snap.hasError && '${snap.error}' == 'MOBILE_UNSUPPORTED';
              final models =
                  snap.connectionState == ConnectionState.done && snap.hasData
                  ? snap.data
                  : (snap.hasError ? const <EngineModel>[] : null);
              EngineModel? current;
              for (final x in models ?? const <EngineModel>[]) {
                if (x.id == m.model) current = x;
              }
              void set(Json patch) {
                if (!mounted || !context.mounted || engine != _engine) return;
                final next = m.update(patch);
                if (m.source != next.source) catalog = loadModels(next.source);
                if (m.source != next.source || m.model != next.model) {
                  speed = loadSpeed(next);
                }
                _setMode(next);
                setSheet(() {});
              }

              return FutureBuilder<Json>(
                future: speed,
                builder: (context, speedSnap) {
                  final ultra =
                      speedSnap.connectionState == ConnectionState.done &&
                      speedSnap.data?['allowed'] == true;
                  return ModePanel(
                    defaultsButtons: sourceSnap.data?.composer == true
                        ? EffortDefaultsButtons(
                            desktop: _desktop,
                            engine: engine,
                            enabled: true,
                            patch: {
                              'effort': ?m.effort,
                              'fast': ?m.fast,
                              'thinkingSummaries': ?m.thinkingSummaries,
                            },
                            reset: (_) => set({
                              'effort': null,
                              'fast': null,
                              'thinkingSummaries': null,
                              'ultrafast': null,
                            }),
                          )
                        : null,

                    header: sourceSnap.data?.composer == true
                        ? TextButton(
                            child: Text(
                              L('搜索全部模型和线路', 'Search models and routes'),
                            ),
                            onPressed: () async {
                              final c = await pickPhoneModel(context, _desktop);
                              if (c == null || !mounted || !context.mounted) {
                                return;
                              }
                              final target = str(c['engine'])!;
                              final source = obj(c['source']);
                              final kind = source['kind'];
                              final key = kind == 'platform'
                                  ? 'platform:${source['groupId']}'
                                  : kind == 'provider'
                                  ? 'provider:${source['id']}'
                                  : 'self';
                              final next =
                                  (target == engine ? m : const _Mode()).update(
                                    {
                                      'source': key,
                                      'model': c['model'],
                                      'effort': null,
                                      'ultrafast': null,
                                    },
                                  );
                              setState(() {
                                _picked = target;
                                _modeEngine = target;
                                _mode = next;
                              });
                              Navigator.of(context).pop();
                            },
                          )
                        : null,
                    toggles: [
                      if (sourceSnap.data?.composer == true)
                        ModeToggle(
                          label: L('做完自动检查', 'Run checks after each turn'),
                          value: m.checks,
                          onChanged: (v) => set({'checks': v}),
                        ),
                    ],
                    title: L('新会话的模式', 'Mode for the new conversation'),
                    readOnly: unsupported,
                    error: unsupported
                        ? L(
                            '电脑上的像素星空版本较旧，新会话用电脑上的设置。',
                            "The computer's PixelSky is out of date. The new conversation uses the computer's settings.",
                          )
                        : null,
                    note: L(
                      '没选的项用电脑上的设置。',
                      "Anything not selected uses the computer's settings.",
                    ),
                    groups: [
                      if (sourceSnap.data?.canPickSource == true)
                        ModeGroup(
                          title: L('模型来源', 'Model source'),
                          options: [
                            ModeOption('', L('跟随电脑', 'Follow computer')),
                            ...sourceOptions(sourceSnap.data!, {}),
                          ],
                          value: m.source ?? '',
                          onPick: (v) async {
                            final from = m.source ?? '';
                            final record = <String, dynamic>{
                              if (from.startsWith('platform:'))
                                'platform': {'groupId': from.substring(9)},
                            };
                            final message = sourceConfirm(
                              sourceSnap.data!,
                              record,
                              v,
                            );
                            if (message != null &&
                                !await confirm(context, message)) {
                              return;
                            }
                            set({
                              'source': v.isEmpty ? null : v,
                              'model': null,
                              'effort': null,
                              'ultrafast': null,
                            });
                          },
                        ),
                      ModeGroup(
                        title: L('权限', 'Permissions'),
                        options: permissionOptions(
                          _engine,
                          null,
                          desktopPermissions:
                              sourceSnap.data?.desktopPermissions == true,
                        ),
                        toggle:
                            (engines[_engine]?.permissionModes.contains(
                                  'plan',
                                ) ??
                                false)
                            ? ModeToggle(
                                label: L('先出计划', 'Plan first'),
                                hint: L(
                                  '只读代码、写计划，你批准后按上面选的档位去做',
                                  'Reads code and writes a plan; after you approve it continues with the level above',
                                ),
                                value: m.plan,
                                onChanged: (v) => set({'plan': v}),
                              )
                            : null,
                        value: m.permissionMode ?? '',
                        onPick: (v) async {
                          if (v.isNotEmpty &&
                              widens(null, v) &&
                              !await confirm(context, permissionConfirm(v))) {
                            return;
                          }
                          set({'permissionMode': v.isEmpty ? null : v});
                        },
                      ),
                      ModeGroup(
                        title: models == null
                            ? L('模型（正在取）', 'Model (loading)')
                            : L('模型', 'Model'),
                        options: m.source == null || m.source == 'self'
                            ? modelOptions(models, m.model)
                            : [
                                ModeOption('', L('来源默认模型', 'Source default')),
                                for (final model
                                    in models ?? const <EngineModel>[])
                                  ModeOption(model.id, model.label),
                              ],
                        value: m.model ?? '',
                        // 换了模型：强度可能不在新模型的范围里，回到默认
                        onPick: (v) => set({
                          'model': v.isEmpty ? null : v,
                          'effort': null,
                          'ultrafast': null,
                        }),
                      ),
                      ModeGroup(
                        title: L('推理强度', 'Reasoning effort'),
                        options: effortOptions(_engine, current, m.effort),
                        value: m.effort ?? '',
                        segmented: true,
                        onPick: (v) => set({'effort': v.isEmpty ? null : v}),
                      ),
                      if (engines[_engine]?.fast == true)
                        ModeGroup(
                          title: L('速度', 'Speed'),
                          options: [
                            ModeOption('', L('电脑上的设置', "Computer's settings")),
                            if (ultra)
                              ModeOption(
                                'ultrafast',
                                speedSnap.data?['multiplier'] == null
                                    ? 'Ultrafast'
                                    : 'Ultrafast ×${speedSnap.data?['multiplier']}',
                              ),
                            ModeOption('off', L('普通', 'Normal')),
                            ModeOption(
                              'on',
                              L('快速模式', 'Fast mode'),
                              hint: fastDefaultHint(),
                            ),
                          ],
                          value: m.fast == null
                              ? ''
                              : m.ultrafast == true && ultra
                              ? 'ultrafast'
                              : m.fast!
                              ? 'on'
                              : 'off',
                          onPick: (v) async {
                            if ((v == 'on' || v == 'ultrafast') &&
                                !await confirm(context, fastConfirm())) {
                              return;
                            }
                            set({
                              'fast': v.isEmpty ? null : v != 'off',
                              'ultrafast': v.isEmpty ? null : v == 'ultrafast',
                            });
                          },
                        ),
                      if (engines[_engine]?.thinkingSummaries == true)
                        ModeGroup(
                          title: L('思考摘要', 'Thinking summaries'),
                          options: [
                            ModeOption('', L('跟随电脑', 'Follow computer')),
                            ModeOption('on', L('显示', 'Show')),
                            if (ultra)
                              ModeOption(
                                'ultrafast',
                                speedSnap.data?['multiplier'] == null
                                    ? 'Ultrafast'
                                    : 'Ultrafast ×${speedSnap.data?['multiplier']}',
                              ),
                            ModeOption('off', L('隐藏', 'Hide')),
                          ],
                          value: m.thinkingSummaries == null
                              ? ''
                              : m.thinkingSummaries!
                              ? 'on'
                              : 'off',
                          onPick: (v) => set({
                            'thinkingSummaries': v.isEmpty ? null : v == 'on',
                          }),
                        ),
                    ],
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final services = AppScope.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([services.lists, services.connections]),
      builder: (context, _) {
        final data = services.lists.get(widget.deviceId);
        final projects = [
          for (final p in data.projects) (id: p.id, name: p.name, path: p.path),
        ];
        final chosen = projects.any((p) => p.id == _projectId)
            ? _projectId
            : (projects.isEmpty ? null : projects.first.id);
        String? projectName;
        for (final p in projects) {
          if (p.id == chosen) projectName = p.name;
        }
        final ready =
            services.connections.state(widget.deviceId) == LinkState.ready &&
            chosen != null;
        final pairing = services.connections.pairings.where(
          (p) => p.deviceId == widget.deviceId,
        );
        Widget pill(IconData? icon, String text, VoidCallback onTap) =>
            Material(
              color: c.bgSurface,
              shape: StadiumBorder(side: BorderSide(color: c.borderCard)),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: onTap,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 9,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (icon != null) ...[
                        Icon(icon, size: 16, color: c.textMuted),
                        const SizedBox(width: 6),
                      ],
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 200),
                        child: Text(
                          text,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: Fs.list, color: c.text),
                        ),
                      ),
                      const SizedBox(width: 2),
                      Icon(Icons.expand_more, size: 16, color: c.textFaint),
                    ],
                  ),
                ),
              ),
            );
        return AppScreen(
          title: L('新对话', 'New conversation'),
          subtitle: pairing.isEmpty
              ? null
              : L(
                  '在 ${pairing.first.desktopName} 上',
                  'On ${pairing.first.desktopName}',
                ),
          leading: RoundIconButton(
            icon: Icons.arrow_back,
            tooltip: L('返回', 'Back'),
            onPressed: () => Navigator.of(context).pop(),
          ),
          body: data.loaded && projects.isEmpty
              ? EmptyState(
                  icon: Icons.folder_outlined,
                  title: L('电脑上还没有项目', 'No projects on the computer yet'),
                  body: L(
                    '先在电脑上的像素星空里添加一个项目文件夹。',
                    'Add a project folder in PixelSky on the computer first.',
                  ),
                )
              : Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          L('想让 AI 做点什么？', 'What should the AI do?'),
                          style: TextStyle(
                            fontSize: Fs.section,
                            fontWeight: FontWeight.w600,
                            color: c.text,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          L(
                            '会在电脑上的项目里运行',
                            'Runs in a project on your computer',
                          ),
                          style: TextStyle(
                            fontSize: Fs.meta,
                            color: c.textFaint,
                          ),
                        ),
                        const SizedBox(height: 18),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          alignment: WrapAlignment.center,
                          children: [
                            pill(
                              Icons.folder_outlined,
                              projectName ?? L('选项目', 'Project'),
                              () => _pickProject(projects, chosen),
                            ),
                            pill(
                              null,
                              engines[_engine]?.name ?? _engine,
                              _pickEngine,
                            ),
                            pill(Icons.tune, _modeText(_modeNow), _openMode),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
          bottom: Composer(
            draft: _draft,
            canAct: ready,
            running: false,
            autofocus: true,
            engineName: engines[_engine]?.name ?? _engine,
            images: _images,
            placeholder: L(
              '例如：把登录页的按钮改成圆角，并补上单元测试',
              'e.g. Round the login buttons and add unit tests',
            ),
            onSend: (text, images) => _create(text, images, chosen!),
          ),
        );
      },
    );
  }
}
