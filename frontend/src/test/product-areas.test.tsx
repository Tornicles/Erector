import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../contexts/AuthContext';
import { appRoutes } from '../App';
import { productionService } from '../services/productions';
import type { Production } from '../types/domain';
import { PRODUCT } from '../types/product';

const { from, auth, localPreview } = vi.hoisted(() => ({ from: vi.fn(), auth: { signOut: vi.fn() }, localPreview: { value: false } }));
vi.mock('../lib/supabase', async original => {
  const actual = await original<typeof import('../lib/supabase')>();
  return { ...actual, localPreview: localPreview.value, requireSupabase: () => ({ from }) };
});
vi.mock('../services/productions', () => ({ PAGE_SIZE:40, productionService:{ list:vi.fn(), listReferences:vi.fn(), getReferences:vi.fn(), get:vi.fn(), scenes:vi.fn(), shots:vi.fn(), saveTitle:vi.fn(), create:vi.fn(), archive:vi.fn(), restore:vi.fn(), setLifecycle:vi.fn(), addReference:vi.fn(), directorProviderStatus:vi.fn(), directorStudioSurface:vi.fn(), directorPlan:vi.fn(), directorCommit:vi.fn(), directorCommand:vi.fn(), directorCommandPreview:vi.fn(), analyzeDirectorReference:vi.fn(), saveDirectorBrief:vi.fn(), recordDirectorDecisions:vi.fn(), directorStoryAlternatives:vi.fn(), directorDialogueOperation:vi.fn() } }));
const userId='00000000-0000-4000-8000-000000000001';const workspaceId='00000000-0000-4000-8000-000000000002';
const prod:Production={id:'00000000-0000-4000-8000-000000000003',workspace_id:workspaceId,project_id:userId,title:'Coffee Film',production_type:'commercial',custom_type:null,execution_method:'real',lifecycle:'active',approval:'draft',locked_at:null,planned_duration_ms:30000,calculated_duration_ms:null,start_ms:0,end_ms:null,created_by:userId,revision:1,created_at:'2026-10-05T00:00:00Z',updated_at:'2026-10-05T00:00:00Z'};
const asset={id:'00000000-0000-4000-8000-000000000004',workspace_id:workspaceId,asset_type:'character',name:'Maya',description:'Lead character',metadata:{},provenance:{},search_metadata:{},consistency_metadata:{},lifecycle:'active',approval:'draft',locked_at:null,revision:1,created_by:userId,created_at:'2026-10-05T00:00:00Z',updated_at:'2026-10-05T00:00:00Z'};
const signedInValue={session:{user:{id:userId,email:'maker@example.test'}},workspaceId,loading:false,error:null,configured:true,localPreview:false,retry:vi.fn()};
function renderAt(path:string, signedIn=true){const router=createMemoryRouter(appRoutes,{initialEntries:[path]});const authValue=signedIn? signedInValue : {...signedInValue,session:null,workspaceId:null,localPreview:true};render(<AuthContext.Provider value={authValue as never}><RouterProvider router={router}/></AuthContext.Provider>);return router;}
function query(data:unknown[]=[],single:unknown=null){const chain={select:vi.fn(()=>chain),eq:vi.fn(()=>chain),order:vi.fn(()=>chain),limit:vi.fn(()=>chain),ilike:vi.fn(()=>chain),in:vi.fn(()=>chain),insert:vi.fn(()=>chain),update:vi.fn(()=>chain),upsert:vi.fn(()=>chain),delete:vi.fn(()=>chain),single:vi.fn(async()=>({data:single,error:null})),maybeSingle:vi.fn(async()=>({data:single,error:null})),then:(resolve:(value:{data:unknown[];error:null})=>unknown,reject?:(reason:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve,reject)};return chain;}
beforeEach(()=>{localStorage.clear();vi.mocked(productionService.list).mockResolvedValue([prod]);vi.mocked(productionService.listReferences).mockResolvedValue([]);vi.mocked(productionService.archive).mockResolvedValue(undefined);vi.mocked(productionService.restore).mockResolvedValue(undefined);from.mockReturnValue(query());});

describe('TONDE area behavior',()=>{
 it('directly searches and archives active Productions, then restores from Archived',async()=>{
  vi.mocked(productionService.archive).mockImplementation(async()=>{vi.mocked(productionService.list).mockResolvedValueOnce([]);});
  vi.mocked(productionService.restore).mockImplementation(async()=>{vi.mocked(productionService.list).mockResolvedValueOnce([prod]);});
  renderAt('/projects');expect(await within(screen.getByRole('main')).findByText('Coffee Film')).toBeVisible();
  const search=screen.getByRole('textbox',{name:'Search productions'});fireEvent.change(search,{target:{value:'coffee'}});
  await waitFor(()=>expect(productionService.list).toHaveBeenLastCalledWith(workspaceId,0,expect.objectContaining({search:'coffee'})),{timeout:1000});
  fireEvent.click(screen.getByRole('button',{name:'Archive Coffee Film'}));expect(screen.getByRole('dialog',{name:'Archive Coffee Film?'})).toBeVisible();expect(productionService.archive).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Archive Production'}));await waitFor(()=>expect(productionService.archive).toHaveBeenCalledWith(prod));
  await waitFor(()=>expect(screen.getByRole('heading',{name:'No productions match that search'})).toBeVisible());
  fireEvent.click(screen.getByRole('button',{name:'Archived'}));await waitFor(()=>expect(productionService.list).toHaveBeenLastCalledWith(workspaceId,0,expect.objectContaining({lifecycle:'archived'})));
  fireEvent.click(await screen.findByRole('button',{name:'Restore Coffee Film'}));await waitFor(()=>expect(productionService.restore).toHaveBeenCalledWith(prod));
 });
 it('shows a truthful global empty notification center rather than a fake count',async()=>{renderAt('/home');fireEvent.click(await screen.findByRole('button',{name:'Notifications'}));expect(screen.getByRole('dialog',{name:'Notifications'})).toHaveTextContent('No new notifications');});
 it('applies the selected appearance rather than storing a no-op setting',async()=>{renderAt('/settings');fireEvent.click(await screen.findByRole('button',{name:'Appearance'}));fireEvent.change(screen.getByRole('combobox',{name:'Color appearance'}),{target:{value:'light'}});expect(document.documentElement).toHaveAttribute('data-appearance','light');expect(localStorage.getItem('tonde:appearance')).toBe('light');});  it('archives a Production only after an impact explanation is confirmed',async()=>{renderAt('/projects');await within(screen.getByRole('main')).findByText('Coffee Film');fireEvent.click(screen.getByRole('button',{name:'Archive Coffee Film'}));expect(screen.getByRole('dialog',{name:'Archive Coffee Film?'})).toHaveTextContent('production history and reusable Assets are retained');expect(productionService.archive).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Archive Production'}));await waitFor(()=>expect(productionService.archive).toHaveBeenCalledWith(prod));});
  it('loads profile/settings preferences through Supabase and persists notification choices',async()=>{const profile=query([], {display_name:'Maker'});const preferences=query([], {email_notifications:true,in_app_notifications:true});from.mockImplementation((table:string)=>table==='user_preferences'?preferences:profile);renderAt('/settings/notifications');await screen.findByRole('checkbox',{name:'In-app notifications'});fireEvent.click(screen.getByRole('checkbox',{name:'In-app notifications'}));await waitFor(()=>expect(preferences.update).toHaveBeenCalledWith({in_app_notifications:false}));});
  it('offers save and cancel for direct Production rename',async()=>{vi.mocked(productionService.saveTitle).mockResolvedValue({...prod,title:'Retitled'});renderAt('/projects');await within(screen.getByRole('main')).findByText('Coffee Film');fireEvent.click(screen.getByRole('button',{name:'Rename Coffee Film'}));fireEvent.change(screen.getByRole('textbox',{name:'New name for Coffee Film'}),{target:{value:'Retitled'}});fireEvent.click(screen.getByRole('button',{name:'Save name'}));await waitFor(()=>expect(productionService.saveTitle).toHaveBeenCalledWith(prod,'Retitled'));});
  it('keeps production resource categories separated from reusable Asset types',()=>{expect(Object.keys(PRODUCT.assetTypes)).toContain('environment');expect(Object.keys(PRODUCT.assetTypes)).not.toContain('camera');expect(PRODUCT.areas.setup.responsibility).toMatch(/equipment/);});
  it('traps focus in the asset detail drawer and restores focus to its invoking row',async()=>{
    const bindings=query();from.mockReturnValueOnce(query([asset])).mockReturnValueOnce(bindings);
    renderAt('/assets');const row=await screen.findByRole('button',{name:/Maya/});row.focus();fireEvent.click(row);
    const drawer=await screen.findByRole('dialog',{name:'Maya asset details'});const close=screen.getByRole('button',{name:'Close asset details'});
    expect(close).toHaveFocus();const drawerArchive=within(drawer).getByRole('button',{name:'Archive Asset'});fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(drawerArchive).toHaveFocus();
    fireEvent.click(close);await waitFor(()=>expect(row).toHaveFocus());expect(drawer).not.toBeInTheDocument();
  });
  it('traps focus in the asset archive confirmation and restores focus to the drawer action',async()=>{
    from.mockReturnValueOnce(query([asset])).mockReturnValueOnce(query([]));
    renderAt('/assets');fireEvent.click(await screen.findByRole('button',{name:/Maya/}));
    const drawer=await screen.findByRole('dialog',{name:'Maya asset details'});const archive=within(drawer).getByRole('button',{name:'Archive Asset'});archive.focus();fireEvent.click(archive);
    const dialog=await screen.findByRole('dialog',{name:'Archive Maya?'});const cancel=within(dialog).getByRole('button',{name:'Cancel archive'});const confirm=within(dialog).getByRole('button',{name:/^Archive Asset$/});
    expect(cancel).toHaveFocus();fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(confirm).toHaveFocus();
    fireEvent.click(cancel);await waitFor(()=>expect(archive).toHaveFocus());expect(dialog).not.toBeInTheDocument();
  });
  it('keeps create controls disabled and contextual when no workspace is configured',async()=>{localPreview.value=true;try{renderAt('/home',false);const intake=within(await screen.findByRole('form',{name:'Director intake'}));expect(intake.getByRole('status')).toHaveTextContent('Local preview only');expect(screen.getByRole('button',{name:'DIRECT THIS →'})).toBeDisabled();expect(screen.getByLabelText('Upload references')).toBeDisabled();}finally{localPreview.value=false;}});
  it('loads and persists account appearance including reduced motion',async()=>{const profile=query([], {display_name:'Maker'});const preferences=query([], {appearance:'dark',email_notifications:true,in_app_notifications:true,reduced_motion:false});from.mockImplementation((table:string)=>table==='user_preferences'?preferences:profile);renderAt('/settings/appearance');await screen.findByRole('checkbox',{name:'Reduce motion'});fireEvent.click(screen.getByRole('checkbox',{name:'Reduce motion'}));await waitFor(()=>expect(preferences.update).toHaveBeenCalledWith({reduced_motion:true}));});
});
