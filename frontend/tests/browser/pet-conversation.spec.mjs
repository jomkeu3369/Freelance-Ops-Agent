import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";
import {quotationPreview} from "./helpers/quotation-preview.mjs";

const profiles = ["꼼꼼이","든든","차근","또렷"].map((name,index) => ({petId:`pet-${index}`,name,
  slot:"RECOMMENDED",animal:index===1?"cat":index===2?"turtle":"owl",color:"lavender",accessory:"none",tone:"WARM",
  valuePriority:"BALANCED",deliveryPriority:"QUALITY",scopePriority:"BALANCED",duty:"GENERAL",skillMode:"AUTO"}));
const draft = {scenario:"RECOMMENDED",items:[{title:"예약 개발",description:"예약 신청",quantity:18,unit:"HOUR",rateCardHint:"예약 개발",basis:{type:"ASSUMPTION",content:"18시간은 검토가 필요한 가정입니다.",sourceReference:null,sourceTitle:null}}]};
const messages = profiles.slice(0,3).map((speaker,index) => ({messageId:`message-${index}`,speakerPetId:speaker.petId,
  speaker,replyToMessageId:index?`message-${index-1}`:null,text:["결제까지 넣으면 검증할 시간이 더 필요해.","예약만 받고 돈은 누가 받냥? 범위를 같이 정하자!","예산과 작업 범위를 확인하고 결정해줘."][index],evidenceRefs:["project"],evidence:[{id:"project",title:"고객 문의",content:"사용자가 작성한 원문"}]}));

async function open(page, {width=1440,locale="ko",theme="light",active=false,loadStatus=200,missingRate=false}={}) {
  await page.setViewportSize({width,height:1000});
  const state = await fixture(page);
  const server = {view:{version:4,settings:{petMode:true,debateEnabled:true,participantPetIds:profiles.slice(0,3).map(p=>p.petId),acceptedDraft:null,draftSourceRunId:null}},saves:[],accepts:[],starts:[],order:[],previews:[],previewStatus:200,cancelStatus:200,saveStatus:200,loadStatus};
  const completed = (status="COMPLETED", petMessages=messages) => ({runId:"run-one",status,activeDepartment:null,interruption:null,errorCode:null,
    result:{projectSummary:"공개 대화",openQuestions:["결제도 넣을까요?"],departmentResults:[],quotationDraft:draft,quotationDrafts:[draft],petMessages},
    metadata:{provider:"OPENAI",model:"gpt-6-luna",petProfiles:profiles.slice(0,3)},usage:null,updatedAt:"2026-10-21T10:00:00Z"});
  state.run = completed(active?"RUNNING":"COMPLETED");
  state.history = [{runId:"run-one",requirementText:"예약 웹사이트를 만들고 싶어",status:state.run.status,createdAt:"2026-10-21T10:00:00Z"}];
  state.events = messages.map((message,index)=>({eventId:index+1,runId:"run-one",type:"pet.message.completed",occurredAt:"2026-10-21T10:00:00Z",data:message}));
  await page.addInitScript(({locale,theme}) => {localStorage.setItem("freelance-ops-ui-locale-v1",locale);localStorage.setItem("theme",theme);},{locale,theme});
  await page.route("**/agent-pets",route=>route.fulfill({json:{pets:profiles.map(profile=>({id:profile.petId,profile,archived:false,revision:1})),selectedPetId:"pet-0",maxActivePets:8,maxStoredPets:24,maxPromptLength:500,maxPreferenceRequests:6,generationMode:"MODEL_PIXEL",aiGenerationAvailable:false}}));
  await page.route("**/pet-conversation",route=>{
    if(route.request().method()==="GET") return route.fulfill({status:server.loadStatus,json:server.loadStatus===200?server.view:{message:"Synthetic unavailable"}});
    server.order.push("settings");server.saves.push(route.request().postDataJSON());
    if(server.saveStatus!==200)return route.fulfill({status:server.saveStatus,json:{message:"CONVERSATION_SETTINGS_CHANGED"}});
    const {expectedVersion,...patch}=route.request().postDataJSON();
    if(expectedVersion!==server.view.version)return route.fulfill({status:409,json:{message:"stale"}});
    server.view={version:server.view.version+1,settings:{...server.view.settings,...patch}};
    return route.fulfill({json:server.view});
  });
  await page.route("**/pet-conversation/draft",route=>{
    server.accepts.push(route.request().postDataJSON());
    server.view={version:server.view.version+1,settings:{...server.view.settings,acceptedDraft:draft,draftSourceRunId:"run-one"}};
    return route.fulfill({json:server.view});
  });
  await page.route("**/rate-cards",route=>route.fulfill({json:missingRate?[]:[{id:"rate-one",workspaceId:"local-space",name:"예약 개발",unit:"HOUR",rate:50000,minimumAmount:0,currency:"KRW",active:true,version:1}]}));
  await page.route("**/quotations/preview",route=>{
    const input=route.request().postDataJSON();server.previews.push(input);
    return route.fulfill({status:server.previewStatus,json:server.previewStatus===200?quotationPreview(input,state.policy):{message:"Calculation unavailable"}});
  });
  await page.route("**/agent-runs",route=>{
    if(route.request().method()!=="POST")return route.fallback();
    const body=route.request().postDataJSON();server.starts.push(body);server.order.push("start");
    const petMessages=server.view.settings.petMode?messages: [{...messages[0],speakerPetId:null,speaker:null,text:"기본 AI로 범위를 검토합니다."}];
    state.run=completed("COMPLETED",petMessages);state.history=[{runId:"run-one",requirementText:body.requirementText,status:"COMPLETED",createdAt:"2026-10-21T10:00:00Z"}];
    state.events=petMessages.map((message,index)=>({eventId:index+1,runId:"run-one",type:"pet.message.completed",occurredAt:"2026-10-21T10:00:00Z",data:message}));
    return route.fulfill({status:202,json:{runId:"run-one",status:"COMPLETED",acceptedAt:"2026-10-21T10:00:00Z"}});
  });
  await page.route("**/agent-runs/run-one/cancel",route=>{
    server.order.push("cancel");
    if(server.cancelStatus!==200)return route.fulfill({status:server.cancelStatus,json:{message:"Synthetic cancel failure"}});
    state.run={...state.run,status:"CANCELLED"};return route.fulfill({json:state.run});
  });
  await page.goto("/workspace/projects/project-one/agent");
  await expect(page.locator(".pet-conversation-team button")).toBeVisible({timeout:30000});
  return {state,server};
}

test("three persisted speakers and replies appear once; work details are replaced by folded history",async({page})=>{
  await open(page);
  await expect(page.locator(".pet-conversation-message")).toHaveCount(3);
  await expect(page.locator(".pet-conversation-reply")).toHaveCount(2);
  await expect(page.getByRole("button",{name:"작업 자세히 보기",exact:true})).toHaveCount(0);
  await expect(page.locator(".pet-conversation-history")).not.toHaveAttribute("open","");
  await page.locator(".pet-conversation-evidence summary").first().click();
  await expect(page.getByText("사용자가 작성한 원문",{exact:true}).first()).toBeVisible();
  await page.screenshot({path:"outputs/pet-conversation-implementation/desktop.png",fullPage:true});
});

test("team selection caps at three, persists a new team and survives reload",async({page})=>{
  const {server}=await open(page);
  await page.getByRole("button",{name:"참여 펫 3/3",exact:true}).click();
  await page.locator(".pet-conversation-choice").filter({hasText:"또렷"}).click();
  await expect(page.getByRole("alert").filter({hasText:"최대 3명"})).toBeVisible();
  await page.locator(".pet-conversation-choice").filter({hasText:"차근"}).click();
  await page.locator(".pet-conversation-choice").filter({hasText:"또렷"}).click();
  await page.getByRole("button",{name:"이 조합으로 이야기하기",exact:true}).click();
  await expect(page.locator(".pet-conversation-team")).toContainText("또렷");
  expect(server.saves[0]).toMatchObject({expectedVersion:4,participantPetIds:["pet-0","pet-1","pet-3"]});
  await page.reload();await expect(page.locator(".pet-conversation-team")).toContainText("또렷");
});

test("pet mode off starts ordinary AI with its saved settings version",async({page})=>{
  const {server}=await open(page);
  await page.getByRole("switch",{name:"펫과 대화",exact:true}).click();
  await expect(page.locator(".pet-conversation-team")).toContainText("기본 AI 대화");
  await page.locator("#agent-chat-input").fill("온라인 결제를 제외하자");
  await page.getByRole("button",{name:"보내기",exact:true}).click();
  await expect.poll(()=>server.starts.length).toBe(1);
  expect(server.starts[0].conversation).toEqual({settingsVersion:5,recipientPetId:null});
  expect(server.starts[0].workflowMode).toBe("AD_HOC");
  await expect(page.locator('[data-speaker-id="ai"]')).toContainText("기본 AI로");
});

test("named recipient and discussion preference are sent through the actual start contract",async({page})=>{
  const {server}=await open(page);
  await page.getByRole("switch",{name:"펫끼리 토론",exact:true}).click();
  await expect.poll(()=>server.saves.length).toBe(1);
  await page.getByLabel("대화할 상대",{exact:true}).selectOption("pet-1");
  await page.locator("#agent-chat-input").fill("든든아, 결제가 왜 필요해?");
  await page.getByRole("button",{name:"보내기",exact:true}).click();
  await expect.poll(()=>server.starts.length).toBe(1);
  expect(server.saves[0].debateEnabled).toBe(false);
  expect(server.starts[0].conversation).toEqual({settingsVersion:5,recipientPetId:"pet-1"});
});

test("interrupt waits for acknowledged cancellation before a new start",async({page})=>{
  const {server}=await open(page,{active:true});
  await page.locator("#agent-chat-input").fill("잠깐, 결제는 빼자");
  await page.getByRole("button",{name:"말 끊고 보내기",exact:true}).click();
  await expect.poll(()=>server.starts.length).toBe(1);
  expect(server.order).toEqual(["cancel","start"]);
});

test("cancel failure preserves the user's draft and never starts another run",async({page})=>{
  const {server}=await open(page,{active:true});server.cancelStatus=503;
  await page.locator("#agent-chat-input").fill("잠깐, 결제는 빼자");
  await page.getByRole("button",{name:"말 끊고 보내기",exact:true}).click();
  await expect(page.locator("#agent-chat-input")).toHaveValue("잠깐, 결제는 빼자");
  await expect(page.getByRole("alert").filter({hasText:/Synthetic|중단/}).first()).toBeVisible();
  expect(server.starts).toEqual([]);
});

test("direct cancellation failure is handled without an unhandled browser rejection",async({page})=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  const {server}=await open(page,{active:true});server.cancelStatus=503;
  await page.locator("#agent-chat-input").fill("작성 중인 내용");
  await page.getByRole("button",{name:"작업 취소",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:/Synthetic|중단/}).first()).toBeVisible();
  await expect(page.locator("#agent-chat-input")).toHaveValue("작성 중인 내용");
  expect(server.starts).toEqual([]);expect(errors).toEqual([]);
});

test("an ineligible keyboard send never cancels the current reply",async({page})=>{
  const {state,server}=await open(page,{active:true});state.aiUsage.spendingEnabled=false;
  await page.reload();
  await page.locator("#agent-chat-input").fill("보낼 수 없는 요청");
  await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeDisabled();
  await page.locator("#agent-chat-input").press("Control+Enter");
  await expect(page.getByRole("alert").filter({hasText:/사용량|모델/}).first()).toBeVisible();
  expect(server.order).toEqual([]);expect(server.starts).toEqual([]);
});

test("a proposed quote remains unapplied until explicit acceptance; review does not publish",async({page})=>{
  const {server,state}=await open(page);
  await expect(page.getByRole("button",{name:"초안에 반영",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"견적 검토하기",exact:true})).toBeDisabled();
  expect(server.accepts).toEqual([]);
  await page.getByRole("button",{name:"초안에 반영",exact:true}).click();
  await expect(page.getByRole("button",{name:"견적 검토하기",exact:true})).toBeEnabled();
  expect(server.accepts).toEqual([{runId:"run-one",expectedVersion:4}]);
  expect(state.writes.some(write=>write.path.endsWith("/publish"))).toBe(false);
});

test("an unknown rate is not presented as zero or free",async({page})=>{
  await open(page,{missingRate:true});
  await expect(page.getByText("연결할 단가를 확인해야 합니다. 미정 항목은 무료로 계산하지 않습니다.",{exact:true})).toBeVisible();
  await expect(page.locator(".pet-conversation-total")).toHaveCount(0);
});

test("pet brief, review and saved draft use the same server minimum, contingency and tax",async({page})=>{
  const {server}=await open(page);
  const authoritative={subtotal:1000000,discountTotal:0,riskBufferRate:.1,riskBufferAmount:100000,
    taxRate:.1,taxAmount:110000,total:1210000,items:[{subtotal:1000000,discountAmount:0,total:1000000}]};
  const previews=[],creates=[];
  await page.route("**/quotations/preview",route=>{previews.push(route.request().postDataJSON());return route.fulfill({json:authoritative});});
  await page.route("**/quotations",route=>{
    const input=route.request().postDataJSON();creates.push(input);
    return route.fulfill({status:201,json:{...input,...authoritative,id:"quote-pricing",workspaceId:"local-space",
      projectId:"project-one",seriesId:"quote-pricing",previousVersionId:null,versionNumber:1,version:0,status:"DRAFT",
      items:input.items.map((item,index)=>({...item,...authoritative.items[index]})),publishedAt:null,createdAt:"2026-10-22T00:00:00Z"}});
  });
  await page.reload();
  await expect(page.locator(".pet-conversation-total")).toContainText("₩1,210,000");
  await expect(page.locator(".pet-conversation-brief")).toContainText("₩100,000");
  await page.getByRole("button",{name:"초안에 반영",exact:true}).click();
  await page.getByRole("button",{name:"견적 검토하기",exact:true}).click();
  await expect(page.locator(".quote-summary .quote-total")).toContainText("₩1,210,000");
  await expect(page.locator(".quote-item-disclosure").first()).toContainText("₩1,000,000");
  await page.getByRole("button",{name:"검토용 초안 저장",exact:true}).click();
  await expect.poll(()=>creates.length).toBe(1);
  expect(creates[0]).toEqual(previews.at(-1));
  expect(previews.every(input=>input.applyDefaultRiskBuffer)).toBe(true);
  await expect(page.locator(".saved-quote")).toContainText("₩1,210,000");
  expect(server.accepts).toHaveLength(1);
});

test("legacy monetary guesses are hidden while effort and reply links remain",async({page})=>{
  const {state}=await open(page);
  state.run.result.petMessages=state.run.result.petMessages.map((message,index)=>index===2
    ? {...message,text:"API는 1.5일로 가정해. 부가세 포함 277만7,500원입니다. 중복 예약 검증은 남겨 두자!"}:message);
  state.events=[];
  await page.reload();
  const reply=page.locator(".pet-conversation-message").last();
  await expect(reply).toContainText("1.5일");
  await expect(reply).toContainText("중복 예약 검증");
  await expect(reply).not.toContainText("277");
  await expect(page.locator(".pet-conversation-reply")).toHaveCount(2);
});

test("calculation failure disables saving without showing a fabricated zero and can retry",async({page})=>{
  const {server}=await open(page);server.previewStatus=503;
  await page.getByRole("button",{name:"초안에 반영",exact:true}).click();
  await page.getByRole("button",{name:"견적 검토하기",exact:true}).click();
  await expect(page.locator(".quote-summary").getByRole("alert")).toContainText("견적 금액을 확인하지 못했습니다.");
  await expect(page.getByRole("button",{name:"검토용 초안 저장",exact:true})).toBeDisabled();
  await expect(page.locator(".quote-summary")).not.toContainText("₩0");
  server.previewStatus=200;
  await page.locator(".quote-summary").getByRole("button",{name:"다시 확인",exact:true}).click();
  await expect(page.locator(".quote-total")).toContainText("₩1,089,000");
  await expect(page.getByRole("button",{name:"검토용 초안 저장",exact:true})).toBeEnabled();
});

test("a policy change before saving refreshes the displayed amount without creating a quotation",async({page})=>{
  const {server,state}=await open(page);
  const creates=[];
  await page.route("**/quotations",route=>{creates.push(route.request().postDataJSON());return route.fulfill({status:500,json:{message:"Unexpected save"}});});
  await page.getByRole("button",{name:"초안에 반영",exact:true}).click();
  await page.getByRole("button",{name:"견적 검토하기",exact:true}).click();
  await expect(page.locator(".quote-total")).toContainText("₩1,089,000");
  state.policy.defaultRiskBufferRate=.2;
  await page.getByRole("button",{name:"검토용 초안 저장",exact:true}).click();
  await expect(page.getByRole("alert").filter({hasText:"계산 기준이 바뀌었습니다."})).toBeVisible();
  expect(creates).toEqual([]);
  await expect(page.locator(".quote-total")).toContainText("₩1,188,000");
  expect(server.previews.at(-1).applyDefaultRiskBuffer).toBe(true);
});

for(const [width,locale,theme] of [[390,"ko","light"],[320,"en","dark"],[1024,"en","light"]]) {
  test(`${width}px ${locale} ${theme}: controls and quote fit the viewport`,async({page})=>{
    const {state}=await open(page,{width,locale,theme});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator(".pet-conversation-message")).toHaveCount(3);
    expect(state.blocked).toEqual([]);
    await page.screenshot({path:`outputs/pet-conversation-implementation/${width}-${locale}-${theme}.png`,fullPage:true});
  });
}
