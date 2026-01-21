import { AppBar as MuiAppBar, Toolbar, Typography, Box } from '@mui/material';
import { UserMenu } from './UserMenu';

export function AppBar() {
  return (
    <MuiAppBar position="static" color="default">
      <Toolbar>
        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
          Enterprise App
        </Typography>
        <Box>
          <UserMenu />
        </Box>
      </Toolbar>
    </MuiAppBar>
  );
}
