import AddIcon from '@mui/icons-material/Add';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Typography
} from '@mui/material';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

// project imports
import { AIResource } from '@prisma/client';
import AIResourceDialog from 'components/application/aifactory/AIResourceDialog';
import ResourceCard from 'components/application/aifactory/ResourceCard';
import {
  ResourceSchema,
  ResourceValues,
  createResource,
  deleteResource,
  updateResource
} from 'components/application/aifactory/ResourceForm';
import Page from 'components/ui-component/Page';
import LAYOUT, { ResourceTypes } from 'constant';
import { useOrganization } from 'feed';
import { useFormik } from 'formik';
import useConfig from 'hooks/useConfig';
import Layout from 'layout';
import { useSession } from 'next-auth/react';
import React, { ReactElement } from 'react';
import { toast } from 'react-toastify';
import { mutate } from 'swr';
import MainCard from 'ui-component/cards/MainCard';

const Resources = () => {
  const theme = useTheme();
  const { data: session } = useSession();
  const organizationId = useConfig().organization;
  const { organization } = useOrganization(organizationId);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const [resourceType, setResourceType] = React.useState('all');
  const [selectedResourceId, setSelectedResourceId] = React.useState('');
  const [selectedResource, setSelectedResource] = React.useState(null);
  const [aiResources, setAiResources] = React.useState(organization?.aiResources);

  const handleEditResourceOpen = () => {
    setEditOpen(true);
  };

  const handleEditResourceClose = () => {
    setEditOpen(false);
  };

  const handleDeleteOpen = () => {
    setDeleteOpen(true);
  };

  const handleDeleteClose = () => {
    setDeleteOpen(false);
  };

  const handleDelete = async () => {
    if (!selectedResourceId) {
      throw Error('none resource');
    }
    await toast.promise(deleteResource(selectedResourceId), {
      pending: '删除中',
      success: '已删除 👌',
      error: '删除失败 🤯'
    });
    handleDeleteClose();
    mutate(`/api/rest/organizations/${organizationId}?include=apps,aiResources`);
  };

  const getFormikInitial = (aiResource: AIResource | null) => {
    const values: ResourceValues = {
      name: aiResource?.name || '',
      type: aiResource?.type || 'OPENAI',
      model: aiResource?.model,
      apiKey: aiResource?.apiKey || '',
      hostUrl: aiResource?.hostUrl || null,
      builtIn: aiResource?.builtIn || false,
      quota: aiResource?.quota || null,
      apiVersion: aiResource?.apiVersion || null
    };
    return values;
  };

  return (
    <Page title="Resources">
      <MainCard
        title={
          <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
            <Stack flexGrow={1} direction={'row'} alignItems={'center'}>
              <Typography variant="h2" component="h2">
                AI 资源
              </Typography>
              <Box sx={{ minWidth: 120, m: 1 }}>
                <Select
                  labelId="resource-select-label"
                  id="resouce-select"
                  value={resourceType}
                  onChange={(e) => {
                    setResourceType(e.target.value);
                    setAiResources(organization.aiResources.filter((r) => r.type === e.target.value || e.target.value === 'all'));
                  }}
                >
                  <MenuItem value="all">全部</MenuItem>
                  {ResourceTypes.map((v, i) => (
                    <MenuItem key={v.code} value={v.code}>
                      {v.name}
                    </MenuItem>
                  ))}
                </Select>
              </Box>
            </Stack>

            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setSelectedResource(null);
                handleEditResourceOpen();
              }}
            >
              添加
            </Button>
          </Box>
        }
      >
        {organization && organization.aiResources ? (
          <Stack spacing={2} divider={<Divider flexItem />}>
            {aiResources.map((resource) => {
              return (
                <ResourceCard
                  aiResource={resource}
                  key={resource.id}
                  onEdit={(r) => {
                    setSelectedResource(r);
                    handleEditResourceOpen();
                  }}
                  onDelete={(r) => {
                    setSelectedResource(r);
                    handleDelete();
                  }}
                />
              );
            })}
          </Stack>
        ) : (
          <Skeleton animation="wave" sx={{ height: 300 }} />
        )}

        <AIResourceDialog
          open={editOpen}
          onDone={() => {
            setEditOpen(false);
            mutate(`/api/rest/organizations/${organizationId}?include=apps,aiResources`);
          }}
          aiResource={selectedResource}
          onCancel={() => {
            setEditOpen(false);
          }}
          organizationId={organizationId}
        />

        <Dialog
          open={deleteOpen}
          onClose={handleDeleteClose}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">删除资源</DialogTitle>
          <DialogContent>
            <DialogContentText id="alert-dialog-description">确认要删除该资源吗？无法恢复</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleDeleteClose}>取消</Button>
            <Button onClick={handleDelete}>删除</Button>
          </DialogActions>
        </Dialog>
      </MainCard>
    </Page>
  );
};

Resources.getLayout = function getLayout(page: ReactElement) {
  return <Layout variant={LAYOUT.MainLayout}>{page}</Layout>;
};

export default Resources;
