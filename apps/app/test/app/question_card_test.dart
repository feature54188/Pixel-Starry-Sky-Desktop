import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pixelsky_app/features/session/approval_card.dart';
import 'package:pixelsky_app/protocol/json.dart';
import 'package:pixelsky_app/ui/theme/tokens.dart';

Future<void> showCard(
  WidgetTester tester,
  Json request,
  List<Json> sent,
) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(extensions: [AppColors.light]),
      home: Scaffold(
        body: ApprovalCard(
          request: Approval({'requestId': 'r1', ...request}),
          canAct: true,
          onAnswer: (decision) async => sent.add(decision),
        ),
      ),
    ),
  );
}

Future<void> submit(WidgetTester tester) async {
  final button = find.text('提交回答');
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pump();
}

void main() {
  testWidgets('在手机上分别点选与填写同题面的两道题，按 ID 提交', (tester) async {
    final sent = <Json>[];
    await showCard(tester, {
      'kind': 'question',
      'questions': [
        {
          'answerKey': 'environment',
          'header': '环境',
          'question': '你的选择？',
          'options': [
            {'label': '开发'},
          ],
        },
        {
          'answerKey': 'name',
          'header': '项目名',
          'question': '你的选择？',
          'options': [],
        },
      ],
    }, sent);
    expect(find.text('你的选择？'), findsNWidgets(2));
    expect(find.text('环境'), findsOneWidget);
    expect(find.text('项目名'), findsOneWidget);
    await tester.tap(find.text('开发'));
    await tester.pump();
    await submit(tester);
    expect(sent, isEmpty);
    await tester.enterText(find.byType(TextFormField), '小程序');
    await tester.pump();
    await submit(tester);
    expect(sent, [
      {
        'type': 'answer',
        'answers': {'environment': '开发', 'name': '小程序'},
      },
    ]);
  });

  testWidgets('手机显示 MCP 字段，仅允许提交有效 JSON 对象', (tester) async {
    final sent = <Json>[];
    await showCard(tester, {
      'kind': 'tool',
      'formSchema': {
        'type': 'object',
        'properties': {
          'project': {'type': 'string'},
        },
      },
    }, sent);
    await tester.tap(find.text('查看表单字段'));
    await tester.pumpAndSettle();
    expect(find.textContaining('"project"'), findsOneWidget);
    final input = find.byType(TextFormField);
    for (final invalid in ['{', '[]']) {
      await tester.ensureVisible(input);
      await tester.enterText(input, invalid);
      await tester.pump();
      expect(find.text('请输入有效的 JSON 对象'), findsOneWidget);
      await submit(tester);
      expect(sent, isEmpty);
    }
    await tester.enterText(input, '{"project":"移动端","count":2}');
    await tester.pump();
    await submit(tester);
    expect(sent, [
      {
        'type': 'form',
        'content': {'project': '移动端', 'count': 2},
      },
    ]);
  });
}
